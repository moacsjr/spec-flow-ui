// Decomposição em duas fases (Plan view do TL — spec §4.4/§4.5 e nota §9):
//   1. PROPOSTA: job LLM lê spec.md + plan.md e produz Stories/Tasks/pontos
//      editáveis (nada é criado no GitHub).
//   2. MATERIALIZAÇÃO: criação sequencial idempotente via API — cada issue
//      criada grava seu issueNumber na proposta; falha interrompe preservando
//      o progresso; "Retomar" pula tudo que já tem issueNumber. Sem rollback
//      destrutivo, sem duplicação.
// Ao concluir: Feature → etapa ✅ Ready + label spec-wave:decompose como
// REGISTRO da decomposição (a Action de decompose é substituída — nota §9).

import { randomUUID } from 'node:crypto';
import {
  addLabel,
  createIssue,
  fetchFileContent,
  fetchIssueRef,
  fetchProjectItemId,
  fetchSingleSelectField,
  listFileCommits,
  moveProjectStage,
  setIssueMilestone,
  setSubIssueParent,
  type GitHubConfig,
} from '../github/client.ts';
import {
  getProposal,
  putProposal,
  type DecompositionProposalRecord,
  type ProposalStory,
} from '../db/dynamo.ts';
import { generateText } from '../llm/openrouter.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { resolveFeaturePaths, setStageForRepository } from './workItemService.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';

const DECOMPOSE_LABEL = 'spec-wave:decompose';
const MAX_PROMPT_CHARS = 8000;
const FIB = [1, 2, 3, 5, 8, 13, 21];

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

// ---- Fase 1: proposta ----

async function runGenerate(tenantId: string, repoId: string, number: number): Promise<void> {
  const config = await configFor(tenantId, repoId);
  const ref = await fetchIssueRef(config, number);
  const { specPath, planPath } = await resolveFeaturePaths(config, number, ref.title);
  const [spec, plan, planCommits] = await Promise.all([
    fetchFileContent(config, specPath),
    fetchFileContent(config, planPath),
    listFileCommits(config, planPath, 1),
  ]);
  if (!plan) throw new HttpError(422, 'plan.md não encontrado — gere o plano antes de decompor.');

  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const answer = await generateText({
    system:
      'Você decompõe uma Feature em User Stories e Tasks a partir da especificação funcional ' +
      'e do plano técnico. Stories na perspectiva do usuário ("Como X, quero Y, para Z"), com ' +
      `pontos na escala Fibonacci (${FIB.join(', ')}); Tasks técnicas objetivas por Story (2 a 5). ` +
      'Responda SOMENTE um array JSON, sem cercas de código: ' +
      '[{"title":"...","userStory":"Como...","points":3,"tasks":[{"title":"..."}]}]',
    user: [
      '## spec.md',
      (spec ?? '(ausente)').slice(0, MAX_PROMPT_CHARS / 2),
      '',
      '## plan.md',
      plan.slice(0, MAX_PROMPT_CHARS / 2),
    ].join('\n'),
    apiKeyOverride: tenantKey,
    maxTokens: 1800,
  });

  let stories: ProposalStory[];
  try {
    const match = answer.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : answer) as {
      title?: unknown;
      userStory?: unknown;
      points?: unknown;
      tasks?: { title?: unknown }[];
    }[];
    stories = parsed
      .filter((s) => typeof s.title === 'string' && (s.title as string).trim())
      .map((s) => ({
        tempId: randomUUID(),
        title: (s.title as string).trim(),
        userStory: typeof s.userStory === 'string' ? (s.userStory as string).trim() : '',
        points:
          typeof s.points === 'number' && Number.isFinite(s.points)
            ? FIB.reduce((b, f) => (Math.abs(f - (s.points as number)) < Math.abs(b - (s.points as number)) ? f : b), FIB[0])
            : 3,
        origin: 'ai' as const,
        tasks: (s.tasks ?? [])
          .filter((t) => typeof t.title === 'string' && (t.title as string).trim())
          .map((t) => ({ tempId: randomUUID(), title: (t.title as string).trim() })),
      }));
  } catch {
    throw new HttpError(502, 'A proposta não retornou em formato válido.');
  }
  if (stories.length === 0) throw new HttpError(502, 'A proposta veio vazia.');

  await putProposal({
    tenantId,
    repoId,
    issueNumber: number,
    planSha: planCommits[0]?.sha ?? null,
    status: 'draft',
    stories,
    updatedAt: new Date().toISOString(),
  });
}

// Gera (ou regenera, substituindo) a proposta. Assíncrono: grava pending e
// dispara o job; o client faz polling do GET.
export async function startGenerateProposal(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  const current = await getProposal(tenantId, repoId, number);
  if (current?.status === 'materializing') {
    throw new HttpError(409, 'A materialização está em andamento — não é possível regerar.');
  }
  await putProposal({
    tenantId,
    repoId,
    issueNumber: number,
    planSha: null,
    status: 'pending',
    stories: [],
    updatedAt: new Date().toISOString(),
  });
  runGenerate(tenantId, repoId, number).catch(async (err: Error) => {
    logger.warn(`Proposta de decomposição de #${number} falhou: ${err.message}`);
    await putProposal({
      tenantId,
      repoId,
      issueNumber: number,
      planSha: null,
      status: 'error',
      stories: [],
      error: err.message,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  });
}

export async function getProposalFor(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<DecompositionProposalRecord | null> {
  return getProposal(tenantId, repoId, number);
}

// Edições do TL (renomear, pontos, remover, fundir, adicionar manual, reordenar):
// o client envia a lista completa de stories; itens já materializados
// (issueNumber) são preservados do registro atual.
export async function saveProposalStories(
  tenantId: string,
  repoId: string,
  number: number,
  stories: ProposalStory[],
): Promise<void> {
  const current = await getProposal(tenantId, repoId, number);
  if (!current) throw new HttpError(404, 'Não há proposta para editar.');
  if (current.status === 'materializing' || current.status === 'done') {
    throw new HttpError(409, 'A proposta está congelada (materialização iniciada).');
  }
  await putProposal({ ...current, stories, updatedAt: new Date().toISOString() });
}

// Plan refinado com proposta em rascunho → invalida (aviso na UI). Fire-and-forget.
export function onPlanSaved(tenantId: string, repoId: string, number: number): void {
  (async () => {
    const current = await getProposal(tenantId, repoId, number);
    if (current && (current.status === 'draft' || current.status === 'invalidated')) {
      await putProposal({ ...current, status: 'invalidated', updatedAt: new Date().toISOString() });
    }
  })().catch((err: Error) =>
    logger.warn(`Invalidação da proposta de #${number} falhou: ${err.message}`),
  );
}

// ---- Fase 2: materialização idempotente ----

async function persist(rec: DecompositionProposalRecord): Promise<void> {
  await putProposal({ ...rec, updatedAt: new Date().toISOString() });
}

// Story Points é um campo single-select no Project (opções "1".."21"): grava a
// opção mais próxima dos pontos da proposta. Best-effort.
async function setStoryPoints(
  config: GitHubConfig,
  storyNumber: number,
  points: number,
): Promise<void> {
  if (!config.project) return;
  try {
    const itemId = await fetchProjectItemId(config, storyNumber, config.project.projectId);
    if (!itemId) return;
    const field = await fetchSingleSelectField(config, config.project.projectId, 'Story Points');
    if (!field) return;
    const target = FIB.reduce((b, f) => (Math.abs(f - points) < Math.abs(b - points) ? f : b), FIB[0]);
    const optionId = field.options[String(target)];
    if (optionId) {
      await moveProjectStage(config, config.project.projectId, itemId, field.id, optionId);
    }
  } catch (err) {
    logger.warn(`Story #${storyNumber}: falha ao gravar Story Points: ${(err as Error).message}`);
  }
}

async function runMaterialize(tenantId: string, repoId: string, number: number): Promise<void> {
  const config = await configFor(tenantId, repoId);
  const rec = await getProposal(tenantId, repoId, number);
  if (!rec) throw new HttpError(404, 'Não há proposta para materializar.');

  const featureRef = await fetchIssueRef(config, number);
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);
  const feature = snapshot.items.find((i) => i.number === number);
  const milestoneNumber = feature?.milestone?.number ?? null;

  try {
    for (const story of rec.stories) {
      // Story: issue [STORY] → sub-issue da Feature → milestone → Ready → pontos.
      if (!story.issueNumber) {
        const created = await createIssue(config, {
          title: `[STORY] ${story.title}`,
          body: story.userStory,
          labels: ['[STORY]'],
        });
        story.issueNumber = created.number;
        story.nodeId = created.nodeId;
        await persist(rec); // progresso persistido item a item (retomada)
        await setSubIssueParent(config, featureRef.nodeId, created.nodeId);
        if (milestoneNumber != null) {
          await setIssueMilestone(config, created.number, milestoneNumber);
        }
        await setStageForRepository(tenantId, repoId, created.number, 'Ready');
        await setStoryPoints(config, created.number, story.points);
        await persist(rec);
      }
      // Tasks: issues [TASK] → sub-issues da Story (sem milestone — herdam).
      for (const task of story.tasks) {
        if (task.issueNumber) continue;
        const created = await createIssue(config, {
          title: `[TASK] ${task.title}`,
          body: '',
          labels: ['[TASK]'],
        });
        task.issueNumber = created.number;
        await persist(rec);
        if (story.nodeId) await setSubIssueParent(config, story.nodeId, created.nodeId);
      }
    }
  } catch (err) {
    rec.status = 'error';
    rec.error = (err as Error).message;
    await persist(rec);
    invalidateSnapshot(tenantId, repoId);
    return;
  }

  // 100% materializado: label de registro + Feature → ✅ Ready (congelamento).
  await addLabel(config, number, DECOMPOSE_LABEL).catch(() => undefined);
  await setStageForRepository(tenantId, repoId, number, 'Ready').catch((err: Error) =>
    logger.warn(`Feature #${number}: falha ao mover para Ready: ${err.message}`),
  );
  rec.status = 'done';
  rec.error = undefined;
  await persist(rec);
  invalidateSnapshot(tenantId, repoId);
}

// Inicia/retoma a materialização (assíncrona; polling via GET da proposta).
export async function startMaterialize(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  const rec = await getProposal(tenantId, repoId, number);
  if (!rec) throw new HttpError(404, 'Não há proposta para materializar.');
  if (rec.status === 'done') throw new HttpError(409, 'A proposta já foi materializada.');
  if (rec.status === 'pending') throw new HttpError(409, 'A proposta ainda está sendo gerada.');
  if (rec.status === 'invalidated') {
    throw new HttpError(422, 'O plano mudou desde a proposta — regenere antes de materializar.');
  }
  if (rec.stories.length === 0) throw new HttpError(422, 'A proposta está vazia.');

  await putProposal({ ...rec, status: 'materializing', updatedAt: new Date().toISOString() });
  runMaterialize(tenantId, repoId, number).catch(async (err: Error) => {
    logger.warn(`Materialização de #${number} falhou: ${err.message}`);
    const cur = await getProposal(tenantId, repoId, number);
    if (cur && cur.status === 'materializing') {
      await putProposal({
        ...cur,
        status: 'error',
        error: err.message,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }
  });
}
