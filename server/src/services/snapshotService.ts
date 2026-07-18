// Snapshot agregado do repositório (RFC-003) — a leitura única que alimenta
// todas as páginas de workspace. Busca as issues flat (paginadas) + milestones
// no GitHub e monta o ProjectSnapshot: level inferido, prioridade/área das
// labels, etapa normalizada a partir do board (Projects v2).

import type {
  Priority,
  ProjectSnapshot,
  SnapshotItem,
  StageName,
} from '@spec-flow/shared';
import type { GhSnapshotIssue } from '../github/types.ts';
import {
  fetchRepoIssuesSnapshot,
  listMilestones,
  type GitHubConfig,
  type ProjectConfig,
} from '../github/client.ts';
import { AREA_NAMES, stripTypePrefix } from '../github/adapter.ts';
import { normalizeStage } from '../lib/status.ts';
import {
  getCachedSnapshot,
  invalidateSnapshot,
  setCachedSnapshot,
} from '../lib/snapshotCache.ts';
import { getDisplayOrder, setDisplayOrder } from '../db/dynamo.ts';
import { HttpError } from '../lib/errors.ts';
import {
  configForRepository,
  getRepositoryOr404,
  toRepositoryDTO,
} from './repositoryService.ts';

type ItemLevel = SnapshotItem['level'];

// Level pelo label de tipo do spec-flow ("[EPIC]"…). Sem label → null.
function levelFromLabels(labels: string[]): ItemLevel | null {
  if (labels.includes('[EPIC]')) return 'epic';
  if (labels.includes('[FEATURE]')) return 'feature';
  if (labels.includes('[STORY]')) return 'story';
  if (labels.includes('[TASK]')) return 'task';
  return null;
}

// Level do filho a partir do level do pai (hierarquia uniforme do RFC-001).
const CHILD_LEVEL: Partial<Record<ItemLevel, ItemLevel>> = {
  epic: 'feature',
  feature: 'story',
  story: 'task',
};

// Infere o level de todas as issues: labels de tipo primeiro; depois propaga
// pela cadeia de pais (filho de epic = feature, etc.) até estabilizar. Issues
// órfãs sem label ficam 'unknown' (bucket próprio na UI).
function inferLevels(issues: GhSnapshotIssue[]): Map<number, ItemLevel> {
  const levels = new Map<number, ItemLevel>();
  for (const issue of issues) {
    const byLabel = levelFromLabels(issue.labels);
    if (byLabel) levels.set(issue.number, byLabel);
  }

  // A hierarquia tem 4 níveis; 4 passadas garantem a propagação completa.
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const issue of issues) {
      if (levels.has(issue.number) || issue.parentNumber == null) continue;
      const parentLevel = levels.get(issue.parentNumber);
      const child = parentLevel ? CHILD_LEVEL[parentLevel] : undefined;
      if (child) {
        levels.set(issue.number, child);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const issue of issues) {
    if (!levels.has(issue.number)) levels.set(issue.number, 'unknown');
  }
  return levels;
}

// Nome cru da etapa no board. Com ProjectConfig, o campo certo é o que tem as
// opções persistidas no cadastro (stageOptions) — cobre "Etapa", "Status" ou
// qualquer outro nome. Sem config, cai para os nomes usuais de campo.
function stageRawOf(issue: GhSnapshotIssue, project: ProjectConfig | undefined): string | null {
  const values = issue.projectFieldValues;
  if (project) {
    for (const value of Object.values(values)) {
      if (value in project.stageOptions) return value;
    }
  }
  return values['Etapa'] ?? values['Status'] ?? null;
}

// "Story Points": campo single-select do Project (opções "1".."21"). Já vem no
// projectFieldValues; convertemos a opção para número. null = sem estimativa.
function pointsOf(issue: GhSnapshotIssue): number | null {
  const raw = issue.projectFieldValues['Story Points'];
  const n = raw != null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

// "Rank": campo numérico do Project gravado na priorização do Backlog (ordem
// fina definida na Prioritization). null = nunca priorizado.
function rankOf(issue: GhSnapshotIssue): number | null {
  const raw = issue.projectFieldValues['Rank'];
  const n = raw != null ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function priorityOf(labels: string[]): Priority | null {
  return (labels.find((n) => /^P[0-3]$/.test(n)) as Priority | undefined) ?? null;
}

function areaOf(labels: string[]): string | null {
  return labels.find((n) => AREA_NAMES.has(n)) ?? null;
}

function toSnapshotItem(
  issue: GhSnapshotIssue,
  level: ItemLevel,
  project: ProjectConfig | undefined,
): SnapshotItem {
  const stageRaw = stageRawOf(issue, project);
  const closed = issue.state === 'CLOSED';
  // Board é a fonte da etapa; issue fechada fora do board conta como Done.
  const stage: StageName | null = normalizeStage(stageRaw) ?? (closed ? 'Done' : null);

  return {
    number: issue.number,
    title: stripTypePrefix(issue.title),
    url: issue.url,
    state: closed ? 'closed' : 'open',
    level,
    labels: issue.labels,
    priority: priorityOf(issue.labels),
    area: areaOf(issue.labels),
    stage,
    stageRaw,
    points: pointsOf(issue),
    rank: rankOf(issue),
    milestone: issue.milestone,
    assignees: issue.assignees.map((u) => ({ login: u.login, name: u.name ?? null })),
    parentNumber: issue.parentNumber,
    createdAt: issue.createdAt,
    progress: issue.subIssuesSummary,
    prs: issue.prs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
      isDraft: pr.isDraft,
      reviewDecision: pr.reviewDecision,
      reviewers: pr.reviewers,
      createdAt: pr.createdAt,
    })),
  };
}

// Monta o snapshot a partir de uma config já resolvida (sem cache — o caller
// de rota usa loadSnapshotForRepository, que cacheia).
export async function buildSnapshot(
  config: GitHubConfig,
  repository: ProjectSnapshot['repository'],
): Promise<ProjectSnapshot> {
  const [issues, milestones] = await Promise.all([
    fetchRepoIssuesSnapshot(config),
    listMilestones(config),
  ]);

  const levels = inferLevels(issues);
  const items = issues.map((issue) =>
    toSnapshotItem(issue, levels.get(issue.number) ?? 'unknown', config.project),
  );

  return {
    repository,
    generatedAt: new Date().toISOString(),
    milestones: milestones.map((m) => ({
      number: m.number,
      title: m.title,
      dueOn: m.dueOn,
      state: m.state,
      openCount: m.openIssues,
      closedCount: m.closedIssues,
      description: m.description,
    })),
    items,
    displayOrder: [], // preenchido por loadSnapshotForRepository (persistido no tenant)
  };
}

// Resolve o repositório do tenant e devolve o snapshot (cacheado por 60s;
// `fresh` força a releitura — botão de refresh do client).
export async function loadSnapshotForRepository(
  tenantId: string,
  repoId: string,
  opts: { fresh?: boolean } = {},
): Promise<ProjectSnapshot> {
  if (!opts.fresh) {
    const cached = getCachedSnapshot(tenantId, repoId);
    if (cached) return cached;
  }

  const record = await getRepositoryOr404(tenantId, repoId);
  const [snapshot, displayOrder] = await Promise.all([
    buildSnapshot(await configForRepository(record), toRepositoryDTO(record)),
    getDisplayOrder(tenantId, repoId),
  ]);
  snapshot.displayOrder = displayOrder;
  setCachedSnapshot(tenantId, repoId, snapshot);
  return snapshot;
}

// Grava a ordem de exibição custom do repositório (tela Project) e invalida o
// snapshot cacheado — a próxima leitura reflete a nova ordem. Best-effort de
// validação: só inteiros positivos entram na lista.
export async function setDisplayOrderForRepository(
  tenantId: string,
  repoId: string,
  order: number[],
): Promise<void> {
  await getRepositoryOr404(tenantId, repoId); // 404 se o repo não for do tenant
  if (!Array.isArray(order) || !order.every((n) => Number.isInteger(n) && n > 0)) {
    throw new HttpError(400, 'Ordem inválida: esperado um array de números de issue.');
  }
  await setDisplayOrder(tenantId, repoId, order);
  invalidateSnapshot(tenantId, repoId);
}
