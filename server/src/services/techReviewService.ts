// Revisão técnica do Tech Leader (Backlog view do TL): rascunhos de comentários
// (staged — nada vai à issue até a devolução), devolução consolidada ao PM,
// ciclo de re-revisão e pré-review por IA (spec × tech_context.yml).
//
// Convenção compartilhada com a tela Specification do PM: comentário de revisão
// com marcador `<!-- spec-review {âncora JSON} -->` (âncora omitida em
// comentários gerais); a triagem do PM vive no SpecTriageRecord.

import { randomUUID } from 'node:crypto';
import {
  addLabel,
  createComment,
  fetchFileContent,
  fetchIssueCommentsFull,
  fetchIssueRef,
  fetchLatestWorkflowRun,
  listFileCommits,
  type GhWorkflowRun,
  type GitHubConfig,
} from '../github/client.ts';
import {
  deleteReviewDraft,
  getPreReview,
  getReviewCycle,
  putPreReview,
  putReviewCycle,
  putReviewDraft,
  queryReviewDrafts,
  querySpecTriage,
  type PreReviewFinding,
  type PreReviewRecord,
  type ReviewDraftRecord,
} from '../db/dynamo.ts';
import { generateText } from '../llm/openrouter.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { resolveFeaturePaths, setStageForRepository } from './workItemService.ts';
import { CHANGES_REQUESTED_LABEL } from './specReviewService.ts';

const TECH_CONTEXT_PATH = '.github/config/tech_context.yml';
const PLAN_WORKFLOW_FILE = 'generate-plan.yml';
const MAX_PROMPT_CHARS = 9000;

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

async function specInfo(
  config: GitHubConfig,
  number: number,
): Promise<{ path: string; content: string | null; sha: string | null }> {
  const ref = await fetchIssueRef(config, number);
  const { specPath } = await resolveFeaturePaths(config, number, ref.title);
  const [content, commits] = await Promise.all([
    fetchFileContent(config, specPath),
    listFileCommits(config, specPath, 1),
  ]);
  return { path: specPath, content, sha: commits[0]?.sha ?? null };
}

// ---- Rascunhos ----

export async function listDrafts(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<ReviewDraftRecord[]> {
  const drafts = await queryReviewDrafts(tenantId, repoId, number);
  return drafts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function createDraft(
  tenantId: string,
  repoId: string,
  number: number,
  input: { body: string; anchor?: unknown; specSha?: string | null },
): Promise<ReviewDraftRecord> {
  const rec: ReviewDraftRecord = {
    tenantId,
    repoId,
    issueNumber: number,
    draftId: randomUUID(),
    body: input.body,
    anchor: input.anchor ?? null,
    specSha: input.specSha ?? null,
    createdAt: new Date().toISOString(),
  };
  await putReviewDraft(rec);
  return rec;
}

export async function updateDraft(
  tenantId: string,
  repoId: string,
  number: number,
  draftId: string,
  body: string,
): Promise<void> {
  const drafts = await queryReviewDrafts(tenantId, repoId, number);
  const draft = drafts.find((d) => d.draftId === draftId);
  if (!draft) throw new HttpError(404, 'Rascunho não encontrado.');
  await putReviewDraft({ ...draft, body });
}

export async function removeDraft(
  tenantId: string,
  repoId: string,
  number: number,
  draftId: string,
): Promise<void> {
  await deleteReviewDraft(tenantId, repoId, number, draftId);
}

// ---- Devolver ao PM (sequência publicadora) ----

export interface ReturnResult {
  ok: boolean;
  step: 'comments' | 'label' | 'stage' | 'cycle' | 'done';
  posted: number;
  total: number;
  error?: string;
}

// Publica os rascunhos como comentários (marcador + âncora), aplica a label de
// devolução, move a etapa para Spec e registra o ciclo. Cada rascunho é removido
// SÓ após a publicação confirmada (falha no meio preserva os restantes; retry é
// idempotente — sem rascunhos restantes, os passos seguintes completam).
export async function returnToPm(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<ReturnResult> {
  const config = await configFor(tenantId, repoId);
  const drafts = await listDrafts(tenantId, repoId, number);
  const { sha } = await specInfo(config, number).catch(() => ({ sha: null }));

  const commentIds: number[] = [];
  let posted = 0;
  for (const draft of drafts) {
    try {
      const marker = draft.anchor
        ? `<!-- spec-review ${JSON.stringify(draft.anchor)} -->`
        : '<!-- spec-review -->';
      const id = await createComment(config, number, `${marker}\n\n${draft.body}`);
      commentIds.push(id);
      posted += 1;
      await deleteReviewDraft(tenantId, repoId, number, draft.draftId);
    } catch (err) {
      return {
        ok: false,
        step: 'comments',
        posted,
        total: drafts.length,
        error: (err as Error).message,
      };
    }
  }

  try {
    await addLabel(config, number, CHANGES_REQUESTED_LABEL);
  } catch (err) {
    return { ok: false, step: 'label', posted, total: drafts.length, error: (err as Error).message };
  }

  try {
    await setStageForRepository(tenantId, repoId, number, 'Spec');
  } catch (err) {
    return { ok: false, step: 'stage', posted, total: drafts.length, error: (err as Error).message };
  }

  try {
    // Um ciclo por item (o mais recente vence); acumula os comentários do retry.
    const prev = await getReviewCycle(tenantId, repoId, number);
    await putReviewCycle({
      tenantId,
      repoId,
      issueNumber: number,
      specSha: sha,
      returnedAt: new Date().toISOString(),
      commentIds: [...(prev?.commentIds ?? []).filter((id) => !commentIds.includes(id)), ...commentIds],
    });
  } catch (err) {
    return { ok: false, step: 'cycle', posted, total: drafts.length, error: (err as Error).message };
  }

  invalidateSnapshot(tenantId, repoId);
  return { ok: true, step: 'done', posted, total: drafts.length };
}

// ---- Ciclo de re-revisão (Diff desde minha revisão) ----

export interface ReviewCycleView {
  specSha: string | null;
  returnedAt: string;
  comments: {
    id: number;
    author: string;
    createdAt: string;
    body: string;
    state: 'pending' | 'accepted' | 'dismissed' | 'applied';
    instruction: string | null;
  }[];
}

const MARKER_RE = /<!--\s*spec-review(\s+(\{[\s\S]*?\}))?\s*-->/;

export async function getReviewCycleView(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<ReviewCycleView | null> {
  const cycle = await getReviewCycle(tenantId, repoId, number);
  if (!cycle) return null;
  const config = await configFor(tenantId, repoId);
  const [comments, triage] = await Promise.all([
    fetchIssueCommentsFull(config, number),
    querySpecTriage(tenantId, repoId, number),
  ]);
  const triageById = new Map(triage.map((t) => [t.commentId, t]));
  const cycleComments = comments
    .filter((c) => cycle.commentIds.includes(c.id))
    .map((c) => {
      const t = triageById.get(c.id);
      return {
        id: c.id,
        author: c.author,
        createdAt: c.createdAt,
        body: c.body.replace(MARKER_RE, '').trim(),
        state: t?.state ?? ('pending' as const),
        instruction: t?.instruction ?? null,
      };
    });
  return { specSha: cycle.specSha, returnedAt: cycle.returnedAt, comments: cycleComments };
}

// ---- Status do plan (fila: itens SEM plan.md; Gerando/Erro) ----

export interface PlanStatus {
  hasPlan: boolean;
  latestRun: GhWorkflowRun | null;
}

export async function getPlanStatus(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<PlanStatus> {
  const config = await configFor(tenantId, repoId);
  const ref = await fetchIssueRef(config, number);
  const { planPath } = await resolveFeaturePaths(config, number, ref.title);
  const [content, latestRun] = await Promise.all([
    fetchFileContent(config, planPath),
    fetchLatestWorkflowRun(config, PLAN_WORKFLOW_FILE).catch(() => null),
  ]);
  return { hasPlan: content !== null, latestRun };
}

// ---- Pré-review por IA ----

async function runPreReview(tenantId: string, repoId: string, number: number): Promise<void> {
  const config = await configFor(tenantId, repoId);
  const { content, sha } = await specInfo(config, number);
  if (!content) {
    await putPreReview({
      tenantId,
      repoId,
      issueNumber: number,
      status: 'error',
      specSha: null,
      findings: [],
      error: 'spec.md não encontrada.',
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  const techContext = (await fetchFileContent(config, TECH_CONTEXT_PATH)) ?? '(ausente)';

  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const answer = await generateText({
    system:
      'Você é um Tech Leader fazendo um pré-review técnico de uma especificação funcional. ' +
      'Confronte a spec com o tech_context (stack/serviços/roles declarados) e aponte lacunas, ' +
      'inconsistências técnicas, dependências não declaradas e riscos. São SUGESTÕES DE ATENÇÃO, ' +
      'não veredictos. Responda SOMENTE um array JSON, sem cercas de código, com até 6 objetos: ' +
      '[{"text":"apontamento objetivo","excerpt":"trecho EXATO copiado da spec (opcional)","severity":"info"|"warning"}]',
    user: [
      '## tech_context.yml',
      techContext.slice(0, 3000),
      '',
      '## Especificação (spec.md)',
      content.slice(0, MAX_PROMPT_CHARS),
    ].join('\n'),
    apiKeyOverride: tenantKey,
    maxTokens: 900,
  });

  let findings: PreReviewFinding[] = [];
  try {
    const match = answer.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : answer) as {
      text?: unknown;
      excerpt?: unknown;
      severity?: unknown;
    }[];
    findings = parsed
      .filter((f) => typeof f.text === 'string' && (f.text as string).trim())
      .slice(0, 6)
      .map((f) => ({
        text: (f.text as string).trim(),
        anchor:
          typeof f.excerpt === 'string' && (f.excerpt as string).trim()
            ? { selectedText: (f.excerpt as string).trim(), specSha: sha }
            : null,
        severity: f.severity === 'warning' ? ('warning' as const) : ('info' as const),
      }));
  } catch {
    throw new HttpError(502, 'O pré-review não retornou achados em formato válido.');
  }

  await putPreReview({
    tenantId,
    repoId,
    issueNumber: number,
    status: 'done',
    specSha: sha,
    findings,
    updatedAt: new Date().toISOString(),
  });
}

// GET: devolve o registro; sem registro → cria pending e dispara a execução
// automática (UMA por item — retornos de devolução não re-executam).
export async function getOrStartPreReview(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<PreReviewRecord> {
  const existing = await getPreReview(tenantId, repoId, number);
  if (existing) return existing;

  const pending: PreReviewRecord = {
    tenantId,
    repoId,
    issueNumber: number,
    status: 'pending',
    specSha: null,
    findings: [],
    updatedAt: new Date().toISOString(),
  };
  await putPreReview(pending);
  runPreReview(tenantId, repoId, number).catch(async (err: Error) => {
    logger.warn(`Pré-review da feature #${number} falhou: ${err.message}`);
    await putPreReview({ ...pending, status: 'error', error: err.message, updatedAt: new Date().toISOString() }).catch(
      () => undefined,
    );
  });
  return pending;
}

// POST run (manual): substitui os achados anteriores.
export async function rerunPreReview(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<PreReviewRecord> {
  const pending: PreReviewRecord = {
    tenantId,
    repoId,
    issueNumber: number,
    status: 'pending',
    specSha: null,
    findings: [],
    updatedAt: new Date().toISOString(),
  };
  await putPreReview(pending);
  runPreReview(tenantId, repoId, number).catch(async (err: Error) => {
    logger.warn(`Pré-review manual da feature #${number} falhou: ${err.message}`);
    await putPreReview({ ...pending, status: 'error', error: err.message, updatedAt: new Date().toISOString() }).catch(
      () => undefined,
    );
  });
  return pending;
}
