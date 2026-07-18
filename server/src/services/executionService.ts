// Telas de execução do Tech Leader (Technical Backlog, Development, QA,
// Progress): pontos inline, devolução para Ready, vereditos de QA e o resumo
// narrativo de progresso por milestone.

import {
  createComment,
  createIssue,
  fetchIssueRef,
  fetchProjectItemId,
  fetchSingleSelectField,
  moveProjectStage,
  setIssueAssignees,
  setIssueMilestone,
  setSubIssueParent,
  type GitHubConfig,
} from '../github/client.ts';
import { generateText } from '../llm/openrouter.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { setStageForRepository, stageAgesForRepository } from './workItemService.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';

const FIB = [1, 2, 3, 5, 8, 13, 21];
const QA_RETURN_MARKER = '<!-- qa-return -->';

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

function typeOfTitle(title: string): 'story' | 'bug' | null {
  const m = title.match(/^\s*\[([A-Z]+)\]/);
  if (m?.[1] === 'STORY') return 'story';
  if (m?.[1] === 'BUG') return 'bug';
  return null;
}

// ---- Story Points inline (Technical Backlog) ----
// Campo single-select do Project: grava a opção mais próxima da escala.
export async function setStoryPointsForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  points: number,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  if (!config.project) throw new HttpError(409, 'Repositório sem Projects v2 vinculado.');
  const itemId = await fetchProjectItemId(config, number, config.project.projectId);
  if (!itemId) throw new HttpError(422, `A issue #${number} não está no board.`);
  const field = await fetchSingleSelectField(config, config.project.projectId, 'Story Points');
  if (!field) throw new HttpError(422, 'O board não tem o campo "Story Points".');
  const target = FIB.reduce((b, f) => (Math.abs(f - points) < Math.abs(b - points) ? f : b), FIB[0]);
  const optionId = field.options[String(target)];
  if (!optionId) throw new HttpError(422, `O campo Story Points não tem a opção "${target}".`);
  await moveProjectStage(config, config.project.projectId, itemId, field.id, optionId);
  invalidateSnapshot(tenantId, repoId);
}

// ---- Devolver para Ready (Development) ----
// Pull por engano / indisponibilidade: limpa o responsável e volta a etapa.
export async function returnToReadyForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await setIssueAssignees(config, number, []);
  await setStageForRepository(tenantId, repoId, number, 'Ready');
  invalidateSnapshot(tenantId, repoId);
}

// ---- Vereditos de QA ----

// Approve roteado por tipo: Story → Homologação (UAT); Bug → Done direto
// (correção técnica não tem validação de negócio — decisão da spec).
export async function qaApproveForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<{ movedTo: 'UAT' | 'Done' }> {
  const config = await configFor(tenantId, repoId);
  const ref = await fetchIssueRef(config, number);
  const type = typeOfTitle(ref.title);
  if (!type) throw new HttpError(422, `A issue #${number} não é Story nem Bug.`);
  const target = type === 'story' ? ('UAT' as const) : ('Done' as const);
  await setStageForRepository(tenantId, repoId, number, target);
  invalidateSnapshot(tenantId, repoId);
  return { movedTo: target };
}

// Return to Development: motivo obrigatório postado como comentário com o
// marcador qa-return; responsável preservado. `createBug` cria a issue [BUG]
// vinculada (parent = Story, milestone herdado — regra D5) já em Ready.
export async function qaReturnForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  reason: string,
  createBug: boolean,
): Promise<{ bugNumber: number | null }> {
  const config = await configFor(tenantId, repoId);
  await createComment(config, number, `${QA_RETURN_MARKER}\n\n**Retorno de QA:** ${reason}`);
  await setStageForRepository(tenantId, repoId, number, 'Development');

  let bugNumber: number | null = null;
  if (createBug) {
    const storyRef = await fetchIssueRef(config, number);
    const snapshot = await loadSnapshotForRepository(tenantId, repoId);
    const story = snapshot.items.find((i) => i.number === number);
    const created = await createIssue(config, {
      title: `[BUG] ${reason.slice(0, 80)}${reason.length > 80 ? '…' : ''}`,
      body: reason,
      labels: ['[BUG]'],
    });
    bugNumber = created.number;
    await setSubIssueParent(config, storyRef.nodeId, created.nodeId);
    if (story?.milestone) {
      await setIssueMilestone(config, created.number, story.milestone.number).catch(() => undefined);
    }
    await setStageForRepository(tenantId, repoId, created.number, 'Ready').catch(() => undefined);
  }

  invalidateSnapshot(tenantId, repoId);
  return { bugNumber };
}

// ---- Resumo narrativo de progresso por milestone (Progress) ----

const EXEC_STAGES = ['Ready', 'Development', 'Code Review', 'QA', 'UAT', 'Done'] as const;

export async function generateProgressSummary(
  tenantId: string,
  repoId: string,
  milestoneNumber: number,
): Promise<string> {
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);
  const milestone = snapshot.milestones.find((m) => m.number === milestoneNumber);
  if (!milestone) throw new HttpError(404, `Milestone #${milestoneNumber} não encontrado.`);

  const items = snapshot.items.filter(
    (i) =>
      i.milestone?.number === milestoneNumber &&
      (i.labels.includes('[STORY]') || i.labels.includes('[BUG]')),
  );

  // Idades por etapa (best-effort — enriquece o contexto do gargalo).
  const ages = new Map<number, { at: string; approximate: boolean }>();
  for (const stage of EXEC_STAGES) {
    try {
      const list = await stageAgesForRepository(tenantId, repoId, stage);
      for (const a of list) ages.set(a.number, a);
    } catch {
      /* best-effort */
    }
  }

  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const lines = items.map((i) => {
    const age = ages.get(i.number);
    const days = age ? Math.floor((Date.now() - Date.parse(age.at)) / 86_400_000) : null;
    return [
      `#${i.number}`,
      i.labels.includes('[BUG]') ? '[BUG]' : '[STORY]',
      i.title,
      `etapa=${i.stage ?? '—'}`,
      i.points != null ? `${i.points}pts` : null,
      i.assignees[0] ? `resp=${i.assignees[0].login}` : 'sem-resp',
      days != null ? `${age?.approximate ? '~' : ''}${days}d na etapa` : null,
      i.prs.length ? `PRs=${i.prs.map((p) => `#${p.number}(${p.state})`).join(',')}` : 'sem-PR',
    ]
      .filter(Boolean)
      .join(' | ');
  });

  return generateText({
    system:
      'Você resume o progresso de execução de um milestone para um Tech Leader, em UM parágrafo ' +
      'narrativo e direto (máximo 5 frases), apontando gargalos, filas vazias e itens sem ' +
      'movimento. Sem listas, sem repetir os dados crus. Responda em português.',
    user: [
      `Milestone: ${milestone.title}${milestone.dueOn ? ` (alvo ${milestone.dueOn.slice(0, 10)})` : ''}`,
      `Itens (${lines.length}):`,
      ...lines,
    ].join('\n'),
    apiKeyOverride: tenantKey,
    maxTokens: 350,
  });
}
