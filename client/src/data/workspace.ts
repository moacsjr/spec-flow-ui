// Mutações dos workspaces (RFC-003): prioridade, delete (fechar issue), etapa,
// milestones e AI insights. Mesmo scaffolding de timeout/abort dos demais
// módulos de dados; endpoints sem corpo de resposta devolvem 204.

import type { MilestoneSummary, Priority, StageName } from '@spec-flow/shared';
import { apiFetch } from './apiFetch';

const REQUEST_TIMEOUT_MS = 15_000;
// Insights chamam a LLM — teto do API Gateway é 29 s; 60 s cobre o dev local.
const INSIGHT_TIMEOUT_MS = 60_000;

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    /* corpo não-JSON */
  }
  return `Falha na operação (HTTP ${res.status}).`;
}

// Requisição JSON genérica; devolve o corpo cru (ou null para 204).
async function request(
  url: string,
  init: { method: string; payload?: unknown; timeoutMs?: number },
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await apiFetch(url, {
      method: init.method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: init.payload === undefined ? undefined : JSON.stringify(init.payload),
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    if (res.status === 204) return null;
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError' && !signal?.aborted) {
      throw new Error('Tempo de requisição esgotado.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

const itemBase = (repoId: string, level: string, number: number): string =>
  `/api/repositories/${repoId}/workitems/${level}/${number}`;

// Set Priority (Backlog/Prioritization do PM): troca os labels P0–P3.
export async function setPriority(
  repoId: string,
  level: string,
  number: number,
  priority: Priority | null,
): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/priority`, {
    method: 'PATCH',
    payload: { priority },
  });
}

// Delete (Backlog do PM): fecha a issue no GitHub.
export async function deleteWorkItem(
  repoId: string,
  level: string,
  number: number,
): Promise<void> {
  await request(itemBase(repoId, level, number), { method: 'DELETE' });
}

// Arquiva (fecha) um item e todos os descendentes. Devolve quantos foram fechados.
export async function archiveWorkItem(
  repoId: string,
  level: string,
  number: number,
): Promise<{ archived: number }> {
  const json = await request(`${itemBase(repoId, level, number)}/archive`, { method: 'POST' });
  return json as { archived: number };
}

// Resultado por item das operações em lote do Backlog.
export interface BulkResult {
  number: number;
  ok: boolean;
  error?: string;
}

// Priorização do Backlog: prioridade + Etapa (Feature → Priorizado; Spike →
// Ready) + rank inicial, numa única chamada.
export async function prioritizeWorkItem(
  repoId: string,
  level: string,
  number: number,
  priority: Priority,
): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/prioritize`, {
    method: 'POST',
    payload: { priority },
    timeoutMs: 30_000,
  });
}

const bulkBase = (repoId: string): string => `/api/repositories/${repoId}/workitems/bulk`;

export async function bulkPrioritize(
  repoId: string,
  numbers: number[],
  priority: Priority,
): Promise<BulkResult[]> {
  const json = await request(`${bulkBase(repoId)}/prioritize`, {
    method: 'POST',
    payload: { numbers, priority },
    timeoutMs: 60_000,
  });
  return (json as { results: BulkResult[] }).results;
}

export async function bulkReparent(
  repoId: string,
  numbers: number[],
  parentNumber: number,
): Promise<BulkResult[]> {
  const json = await request(`${bulkBase(repoId)}/reparent`, {
    method: 'POST',
    payload: { numbers, parentNumber },
    timeoutMs: 60_000,
  });
  return (json as { results: BulkResult[] }).results;
}

export async function bulkArchive(repoId: string, numbers: number[]): Promise<BulkResult[]> {
  const json = await request(`${bulkBase(repoId)}/archive`, {
    method: 'POST',
    payload: { numbers },
    timeoutMs: 60_000,
  });
  return (json as { results: BulkResult[] }).results;
}

// Rank (drag de reordenação da Prioritization): grava o campo numérico do board.
export async function setRank(
  repoId: string,
  level: string,
  number: number,
  rank: number,
): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/rank`, {
    method: 'PATCH',
    payload: { rank },
    timeoutMs: 30_000,
  });
}

// Idades por etapa (tempo-na-etapa; approximate = entrada estimada na reconciliação).
export interface StageAge {
  number: number;
  at: string; // ISO
  approximate: boolean;
}

export async function fetchStageAges(repoId: string, stage: StageName): Promise<StageAge[]> {
  const json = await request(
    `/api/repositories/${repoId}/stage-ages?stage=${encodeURIComponent(stage)}`,
    { method: 'GET' },
  );
  return (json as { ages: StageAge[] }).ages;
}

// ---- Tela Planning do PM (composição de releases) ----

export interface CascadeItemResult {
  number: number;
  ok: boolean;
  error?: string;
}

// Milestone da FEATURE com cascata para Stories/Bugs filhos. Falha parcial
// reverte a feature inteira no backend (ok=false + resultado por sub-item).
export async function setFeatureMilestone(
  repoId: string,
  featureNumber: number,
  milestoneNumber: number | null,
): Promise<{ ok: boolean; results: CascadeItemResult[] }> {
  const json = await request(`${itemBase(repoId, 'feature', featureNumber)}/milestone`, {
    method: 'PATCH',
    payload: { milestoneNumber },
    timeoutMs: 60_000,
  });
  return json as { ok: boolean; results: CascadeItemResult[] };
}

// Override manual da estimativa (origem manual; a IA não sobrescreve).
export async function setEstimate(
  repoId: string,
  featureNumber: number,
  points: number,
): Promise<void> {
  await request(`${itemBase(repoId, 'feature', featureNumber)}/estimate`, {
    method: 'PATCH',
    payload: { points },
    timeoutMs: 30_000,
  });
}

export interface EstimateMeta {
  issueNumber: number;
  origin: 'ai' | 'manual';
  stale: boolean;
}

export async function fetchEstimatesMeta(repoId: string): Promise<EstimateMeta[]> {
  const json = await request(`/api/repositories/${repoId}/estimates-meta`, { method: 'GET' });
  return (json as { estimates: EstimateMeta[] }).estimates;
}

// ---- Revisão técnica do TL (Backlog view do Tech Leader) ----

export interface ReviewDraft {
  draftId: string;
  body: string;
  anchor: { selectedText?: string } | null;
  specSha: string | null;
  createdAt: string;
}

export async function fetchReviewDrafts(repoId: string, n: number): Promise<ReviewDraft[]> {
  const json = await request(`${itemBase(repoId, 'feature', n)}/review-drafts`, { method: 'GET' });
  return (json as { drafts: ReviewDraft[] }).drafts;
}

export async function createReviewDraft(
  repoId: string,
  n: number,
  input: { body: string; anchor?: unknown; specSha?: string | null },
): Promise<void> {
  await request(`${itemBase(repoId, 'feature', n)}/review-drafts`, {
    method: 'POST',
    payload: input,
  });
}

export async function updateReviewDraft(
  repoId: string,
  n: number,
  draftId: string,
  body: string,
): Promise<void> {
  await request(`${itemBase(repoId, 'feature', n)}/review-drafts/${draftId}`, {
    method: 'PATCH',
    payload: { body },
  });
}

export async function deleteReviewDraft(
  repoId: string,
  n: number,
  draftId: string,
): Promise<void> {
  await request(`${itemBase(repoId, 'feature', n)}/review-drafts/${draftId}`, {
    method: 'DELETE',
  });
}

export interface ReturnToPmResult {
  ok: boolean;
  step: 'comments' | 'label' | 'stage' | 'cycle' | 'done';
  posted: number;
  total: number;
  error?: string;
}

export async function returnFeatureToPm(repoId: string, n: number): Promise<ReturnToPmResult> {
  const json = await request(`${itemBase(repoId, 'feature', n)}/return-to-pm`, {
    method: 'POST',
    timeoutMs: 60_000,
  });
  return json as ReturnToPmResult;
}

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

export async function fetchReviewCycle(repoId: string, n: number): Promise<ReviewCycleView | null> {
  const json = await request(`${itemBase(repoId, 'feature', n)}/review-cycle`, { method: 'GET' });
  return (json as { cycle: ReviewCycleView | null }).cycle;
}

export interface PlanStatus {
  hasPlan: boolean;
  latestRun: { status: string; conclusion: string | null; url: string; createdAt: string } | null;
}

export async function fetchPlanStatus(repoId: string, n: number): Promise<PlanStatus> {
  return (await request(`${itemBase(repoId, 'feature', n)}/plan/status`, {
    method: 'GET',
  })) as PlanStatus;
}

export interface PreReviewFinding {
  text: string;
  anchor: { selectedText?: string } | null;
  severity: 'info' | 'warning';
}

export interface PreReviewState {
  status: 'pending' | 'done' | 'error';
  specSha: string | null;
  findings: PreReviewFinding[];
  error?: string;
}

export async function fetchPreReview(repoId: string, n: number): Promise<PreReviewState> {
  return (await request(`${itemBase(repoId, 'feature', n)}/pre-review`, {
    method: 'GET',
  })) as PreReviewState;
}

export async function rerunPreReview(repoId: string, n: number): Promise<void> {
  await request(`${itemBase(repoId, 'feature', n)}/pre-review/run`, { method: 'POST' });
}

// ---- Telas de execução do TL ----

// Story Points inline (Technical Backlog).
export async function setPoints(
  repoId: string,
  level: string,
  number: number,
  points: number,
): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/points`, {
    method: 'PATCH',
    payload: { points },
    timeoutMs: 30_000,
  });
}

// Devolver para Ready (Development): limpa responsável + etapa Ready.
export async function returnToReady(repoId: string, level: string, number: number): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/return-to-ready`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

// Approve de QA (Story → Homologação/UAT; Bug → Done).
export async function qaApprove(
  repoId: string,
  level: string,
  number: number,
): Promise<{ movedTo: 'UAT' | 'Done' }> {
  const json = await request(`${itemBase(repoId, level, number)}/qa-approve`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
  return json as { movedTo: 'UAT' | 'Done' };
}

// Return to Development de QA (motivo obrigatório; bug opcional — regra D5).
export async function qaReturn(
  repoId: string,
  level: string,
  number: number,
  reason: string,
  createBug: boolean,
): Promise<{ bugNumber: number | null }> {
  const json = await request(`${itemBase(repoId, level, number)}/qa-return`, {
    method: 'POST',
    payload: { reason, createBug },
    timeoutMs: 60_000,
  });
  return json as { bugNumber: number | null };
}

// Resumo narrativo de progresso por milestone (Progress).
export async function fetchProgressSummary(
  repoId: string,
  milestoneNumber: number,
): Promise<string> {
  const json = await request(
    `/api/repositories/${repoId}/milestones/${milestoneNumber}/progress-summary`,
    { method: 'POST', timeoutMs: 60_000 },
  );
  return (json as { content: string }).content;
}

// ---- Workspace do Developer ----

// Identidade GitHub da sessão (GET/PUT /api/me). O backend guarda o vínculo
// usuário Cognito → login do GitHub (não há OAuth de usuário no GitHub App) e,
// opcionalmente, o Slack member ID (convite ao canal de discussão).
export interface Me {
  login: string | null;
  slackUserId: string | null;
  email: string | null;
  isRoot: boolean; // owner do tenant (administração)
  enforced: boolean; // papéis reais ativos (AUTH_ENFORCED)
  roles: { repoId: string; roles: string[] }[]; // papéis de trabalho por repositório
}

export async function fetchMe(): Promise<Me> {
  return (await request('/api/me', { method: 'GET' })) as Me;
}

export async function saveMyLogin(login: string | null): Promise<string | null> {
  const json = await request('/api/me', { method: 'PUT', payload: { login } });
  return (json as { login: string | null }).login;
}

export async function saveMySlackId(slackUserId: string | null): Promise<string | null> {
  const json = await request('/api/me', { method: 'PUT', payload: { slackUserId } });
  return (json as { slackUserId: string | null }).slackUserId;
}

// ---- Discussão integrada (canal Slack por Feature) ----

export interface DiscussionInfo {
  itemNumber: number;
  channelName: string;
  channelLink: string;
}

export async function openDiscussion(
  repoId: string,
  featureNumber: number,
  commentId: number,
): Promise<{ channelLink: string; created: boolean }> {
  const json = await request(`${itemBase(repoId, 'feature', featureNumber)}/discussion`, {
    method: 'POST',
    payload: { commentId },
    timeoutMs: 30_000,
  });
  return json as { channelLink: string; created: boolean };
}

export async function fetchDiscussions(repoId: string): Promise<DiscussionInfo[]> {
  const json = await request(`/api/repositories/${repoId}/discussions`, {
    method: 'GET',
    timeoutMs: 30_000,
  });
  return (json as { discussions: DiscussionInfo[] }).discussions;
}

// Start Story (Pending): assignee = usuário da sessão + etapa Development.
export async function startWork(
  repoId: string,
  level: string,
  number: number,
): Promise<{ login: string }> {
  const json = await request(`${itemBase(repoId, level, number)}/start`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
  return json as { login: string };
}

// Task checável (In Progress): marcar fecha a issue da Task; desmarcar reabre.
export async function setTaskState(
  repoId: string,
  number: number,
  done: boolean,
): Promise<void> {
  await request(`${itemBase(repoId, 'task', number)}/state`, {
    method: 'PATCH',
    payload: { done },
    timeoutMs: 30_000,
  });
}

// Retorno do ciclo corrente de Desenvolvimento (badge do card): a origem
// distingue a reprovação do QA (TL) da reprovação da Homologação (PM).
export interface QaReturnInfo {
  reason: string;
  at: string;
  origin: 'qa' | 'uat';
}

export async function fetchQaReturnInfo(
  repoId: string,
  number: number,
): Promise<QaReturnInfo | null> {
  const json = await request(`${itemBase(repoId, 'story', number)}/qa-return-info`, {
    method: 'GET',
    timeoutMs: 30_000,
  });
  return json as QaReturnInfo | null;
}

// ---- Homologação do PM (aceite de negócio) ----

// Approve: Story → Done + verificação D4 (fechamento automático da Feature).
export async function uatApprove(
  repoId: string,
  number: number,
): Promise<{ featureClosed: boolean; featureNumber: number | null; pendingCheck: boolean }> {
  const json = await request(`${itemBase(repoId, 'story', number)}/uat-approve`, {
    method: 'POST',
    timeoutMs: 60_000,
  });
  return json as { featureClosed: boolean; featureNumber: number | null; pendingCheck: boolean };
}

// Return to Development da Homologação (marcador uat-return; bug opcional).
export async function uatReturn(
  repoId: string,
  number: number,
  reason: string,
  createBug: boolean,
): Promise<{ bugNumber: number | null }> {
  const json = await request(`${itemBase(repoId, 'story', number)}/uat-return`, {
    method: 'POST',
    payload: { reason, createBug },
    timeoutMs: 60_000,
  });
  return json as { bugNumber: number | null };
}

// Seção do spec.md da Feature (ex.: "Critérios de aceite") para o painel.
export interface SpecSection {
  path: string;
  heading: string | null;
  content: string | null;
  hasSpec: boolean;
}

export async function fetchSpecSection(
  repoId: string,
  featureNumber: number,
  heading: string,
): Promise<SpecSection> {
  const json = await request(
    `${itemBase(repoId, 'feature', featureNumber)}/spec-section?heading=${encodeURIComponent(heading)}`,
    { method: 'GET', timeoutMs: 30_000 },
  );
  return json as SpecSection;
}

// ---- Plan view do TL (plan.md + decomposição) ----

export async function fetchPlanMeta(repoId: string, n: number): Promise<SpecMeta> {
  return (await request(`${specBase(repoId, n)}/plan/meta`, { method: 'GET' })) as SpecMeta;
}

export async function fetchPlanBlob(repoId: string, n: number, sha: string): Promise<string> {
  const json = await request(`${specBase(repoId, n)}/plan/blob/${sha}`, { method: 'GET' });
  return (json as { content: string }).content;
}

export interface PlanValidation {
  latestRun: { status: string; conclusion: string | null; url: string; createdAt: string } | null;
  report: { passed: boolean; issues: { document: 'spec' | 'plan'; message: string }[] } | null;
}

export async function fetchPlanValidation(repoId: string): Promise<PlanValidation> {
  return (await request(`/api/repositories/${repoId}/plan-validation`, {
    method: 'GET',
  })) as PlanValidation;
}

export interface ProposalTask {
  tempId: string;
  title: string;
  issueNumber?: number;
}

export interface ProposalStory {
  tempId: string;
  title: string;
  userStory: string;
  points: number;
  origin: 'ai' | 'manual';
  issueNumber?: number;
  tasks: ProposalTask[];
}

export interface DecompositionProposal {
  planSha: string | null;
  status: 'pending' | 'draft' | 'invalidated' | 'materializing' | 'done' | 'error';
  stories: ProposalStory[];
  error?: string;
  updatedAt: string;
}

export async function generateDecomposition(repoId: string, n: number): Promise<void> {
  await request(`${specBase(repoId, n)}/decomposition/generate`, { method: 'POST' });
}

export async function fetchDecomposition(
  repoId: string,
  n: number,
): Promise<DecompositionProposal | null> {
  const json = await request(`${specBase(repoId, n)}/decomposition`, { method: 'GET' });
  return (json as { proposal: DecompositionProposal | null }).proposal;
}

export async function saveDecomposition(
  repoId: string,
  n: number,
  stories: ProposalStory[],
): Promise<void> {
  await request(`${specBase(repoId, n)}/decomposition`, {
    method: 'PATCH',
    payload: { stories },
  });
}

export async function materializeDecomposition(repoId: string, n: number): Promise<void> {
  await request(`${specBase(repoId, n)}/decomposition/materialize`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

// ---- Tela Specification do PM (revisão do spec.md) ----

const specBase = (repoId: string, n: number): string =>
  `/api/repositories/${repoId}/workitems/feature/${n}`;

export interface SpecVersion {
  sha: string;
  message: string;
  committedAt: string;
}

export interface SpecMeta {
  path: string;
  content: string | null;
  sha: string | null;
  versions: SpecVersion[];
}

export interface SpecStatus {
  hasSpec: boolean;
  latestRun: { status: string; conclusion: string | null; url: string; createdAt: string } | null;
}

export type ReviewTriageState = 'pending' | 'accepted' | 'dismissed' | 'applied';

export interface ReviewComment {
  id: number;
  author: string;
  createdAt: string;
  body: string;
  anchor: { selectedText?: string } | null;
  state: ReviewTriageState;
  instruction: string | null;
}

export async function fetchSpecMeta(repoId: string, n: number): Promise<SpecMeta> {
  return (await request(`${specBase(repoId, n)}/spec/meta`, { method: 'GET' })) as SpecMeta;
}

export async function fetchSpecBlob(repoId: string, n: number, sha: string): Promise<string> {
  const json = await request(`${specBase(repoId, n)}/spec/blob/${sha}`, { method: 'GET' });
  return (json as { content: string }).content;
}

export async function fetchSpecStatus(repoId: string, n: number): Promise<SpecStatus> {
  return (await request(`${specBase(repoId, n)}/spec/status`, { method: 'GET' })) as SpecStatus;
}

export async function fetchReviewComments(repoId: string, n: number): Promise<ReviewComment[]> {
  const json = await request(`${specBase(repoId, n)}/review-comments`, { method: 'GET' });
  return (json as { comments: ReviewComment[] }).comments;
}

export async function setReviewTriage(
  repoId: string,
  n: number,
  commentId: number,
  state: ReviewTriageState,
  instruction?: string,
): Promise<void> {
  await request(`${specBase(repoId, n)}/review-comments/${commentId}`, {
    method: 'PATCH',
    payload: { state, ...(instruction !== undefined ? { instruction } : {}) },
  });
}

export async function replyReviewComment(repoId: string, n: number, body: string): Promise<void> {
  await request(`${specBase(repoId, n)}/review-comments/reply`, {
    method: 'POST',
    payload: { body },
  });
}

export async function approveSpec(
  repoId: string,
  n: number,
  milestoneNumber: number | null,
): Promise<void> {
  await request(`${specBase(repoId, n)}/spec/approve`, {
    method: 'POST',
    payload: { milestoneNumber },
    timeoutMs: 30_000,
  });
}

export async function returnToPrioritization(repoId: string, n: number): Promise<void> {
  await request(`${specBase(repoId, n)}/return-to-prioritization`, {
    method: 'POST',
    timeoutMs: 30_000,
  });
}

// Reparent (drag-and-drop da árvore na tela Project): define `parentNumber` como
// pai de `childNumber`. O server valida a hierarquia permitida e atualiza a
// sub-issue nativa. Encadeia chamadas ao GitHub → timeout maior.
export async function reparentWorkItem(
  repoId: string,
  childNumber: number,
  parentNumber: number,
): Promise<void> {
  await request(`/api/repositories/${repoId}/reparent`, {
    method: 'POST',
    payload: { childNumber, parentNumber },
    timeoutMs: 30_000,
  });
}

// Reorder (Shift-drag da árvore na tela Project): grava a ordem de exibição
// custom (lista global de números). O server persiste no tenant e invalida o
// snapshot; o caller faz `refresh()`.
export async function reorderWorkItems(repoId: string, order: number[]): Promise<void> {
  await request(`/api/repositories/${repoId}/reorder`, {
    method: 'POST',
    payload: { order },
  });
}

// Move a etapa canônica no board (Start Story, aprovar/devolver UAT…).
export async function setStage(
  repoId: string,
  level: string,
  number: number,
  stage: StageName,
): Promise<void> {
  await request(`${itemBase(repoId, level, number)}/stage`, {
    method: 'PATCH',
    payload: { stage },
  });
}

// --- Milestones (Planning) ---

export async function createMilestone(
  repoId: string,
  input: { title: string; dueOn?: string | null; description?: string },
): Promise<MilestoneSummary> {
  const json = await request(`/api/repositories/${repoId}/milestones`, {
    method: 'POST',
    payload: input,
  });
  return json as MilestoneSummary;
}

export async function updateMilestone(
  repoId: string,
  milestoneNumber: number,
  patch: { title?: string; dueOn?: string | null; state?: 'open' | 'closed'; description?: string },
): Promise<void> {
  await request(`/api/repositories/${repoId}/milestones/${milestoneNumber}`, {
    method: 'PATCH',
    payload: patch,
  });
}

// Exclui um milestone no GitHub (as stories ficam sem milestone).
export async function deleteMilestone(
  repoId: string,
  milestoneNumber: number,
): Promise<void> {
  await request(`/api/repositories/${repoId}/milestones/${milestoneNumber}`, {
    method: 'DELETE',
  });
}

// Aciona a LLM para gerar Release Notes das Stories do milestone. Retorna o
// texto (markdown); a persistência fica a cargo do chamador (metadados).
export async function generateReleaseNotes(
  repoId: string,
  milestoneNumber: number,
): Promise<string> {
  const json = await request(
    `/api/repositories/${repoId}/milestones/${milestoneNumber}/release-notes`,
    { method: 'POST' },
  );
  return (json as { content: string }).content;
}

// Atribui/remove (null) o milestone de uma Story — sincroniza o GitHub Milestone.
export async function setStoryMilestone(
  repoId: string,
  storyNumber: number,
  milestoneNumber: number | null,
): Promise<void> {
  await request(`/api/repositories/${repoId}/workitems/story/${storyNumber}/milestone`, {
    method: 'PUT',
    payload: { milestoneNumber },
  });
}

// --- AI insights (fase 5) ---

export type InsightScope = 'pm-progress' | 'tech-insights' | 'dev-daily' | 'brainstorm';

export async function fetchInsight(
  repoId: string,
  scope: InsightScope,
  topic?: string,
  signal?: AbortSignal,
): Promise<string> {
  const json = await request(
    `/api/repositories/${repoId}/ai/summary`,
    {
      method: 'POST',
      payload: topic === undefined ? { scope } : { scope, topic },
      timeoutMs: INSIGHT_TIMEOUT_MS,
    },
    signal,
  );
  const content = (json as { content?: unknown })?.content;
  if (typeof content !== 'string') {
    throw new Error('Resposta da API em formato inesperado.');
  }
  return content;
}
