// Fonte de dados das telas de work item — consome GET /api/workitems/:level/:number
// do backend, que faz toda a integração com o GitHub e devolve o WorkItemView
// pronto para exibição. O frontend não conhece token nem a forma das issues.
// Em dev, o Vite faz proxy de /api para a porta 3001 (veja vite.config.ts).

import type {
  ArtifactKind,
  CreatedWorkItem,
  CreateFeatureRequest,
  CreateWorkItemRequest,
  Level,
  WorkItemPatch,
  WorkItemView,
} from '@spec-flow/shared';
import { apiFetch } from './apiFetch';

const REQUEST_TIMEOUT_MS = 10_000;
// Criar a feature encadeia várias chamadas ao GitHub (issue + sub-issue + board).
const CREATE_FEATURE_TIMEOUT_MS = 30_000;
// O refino chama a LLM (OpenRouter) — pode levar dezenas de segundos.
const LLM_TIMEOUT_MS = 120_000;

function isWorkItemView(value: unknown): value is WorkItemView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.level === 'string' &&
    typeof v.title === 'string' &&
    Array.isArray(v.children) &&
    Array.isArray(v.breadcrumb)
  );
}

// Tenta extrair a mensagem de erro do corpo JSON ({ error }) da resposta.
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    /* corpo não-JSON: usa o status abaixo */
  }
  return `Falha ao carregar o item (HTTP ${res.status}).`;
}

export async function fetchWorkItem(
  repoId: string,
  level: Level,
  number: number,
  signal?: AbortSignal,
): Promise<WorkItemView> {
  // Aborta por timeout OU pelo signal externo (troca de rota / unmount).
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await apiFetch(`/api/repositories/${repoId}/workitems/${level}/${number}`, {
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    const json: unknown = await res.json();
    if (!isWorkItemView(json)) {
      throw new Error('Resposta da API em formato inesperado.');
    }
    return json;
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

// Faz um POST JSON com o mesmo scaffolding de timeout/abort, validando que a
// resposta é um WorkItemView. `timeoutMs` é configurável (refino usa um maior).
async function postForView(
  url: string,
  payload: unknown,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkItemView> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    const json: unknown = await res.json();
    if (!isWorkItemView(json)) {
      throw new Error('Resposta da API em formato inesperado.');
    }
    return json;
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

const artifactBase = (repoId: string, number: number, kind: ArtifactKind): string =>
  `/api/repositories/${repoId}/workitems/feature/${number}/${kind}`;

// Cria o artefato: aplica o label do spec-wave + move a etapa. A geração do
// arquivo fica a cargo da GitHub Action — o caller faz o poll de fetchWorkItem.
export async function createArtifact(
  repoId: string,
  number: number,
  kind: ArtifactKind,
): Promise<WorkItemView> {
  return postForView(`${artifactBase(repoId, number, kind)}/create`, {}, REQUEST_TIMEOUT_MS);
}

// Aprova o plano: aplica o label spec-wave:ready na Feature e devolve o
// WorkItemView recarregado.
export async function approvePlan(repoId: string, number: number): Promise<WorkItemView> {
  return postForView(
    `/api/repositories/${repoId}/workitems/feature/${number}/plan/approve`,
    {},
    REQUEST_TIMEOUT_MS,
  );
}

// Inicia decomposição: aplica spec-wave:decompose (dispara a Action).
export async function decomposeFeature(repoId: string, number: number): Promise<WorkItemView> {
  return postForView(
    `/api/repositories/${repoId}/workitems/feature/${number}/decompose`,
    {},
    REQUEST_TIMEOUT_MS,
  );
}

// Cria uma Feature sob o épico (issue [FEATURE] + vínculo de sub-issue + board)
// e devolve o WorkItemView do épico recarregado — o caller troca a view inteira.
export async function createFeature(
  repoId: string,
  epicNumber: number,
  input: CreateFeatureRequest,
): Promise<WorkItemView> {
  return postForView(
    `/api/repositories/${repoId}/workitems/epic/${epicNumber}/features`,
    input,
    CREATE_FEATURE_TIMEOUT_MS,
  );
}

// Cria um work item de qualquer tipo (tela Project do PM). O server cria a issue
// com o label de tipo, vincula ao parent (se houver) e adiciona ao board; o
// caller faz `refresh()` do snapshot. Timeout estendido (encadeia chamadas ao GitHub).
export async function createWorkItem(
  repoId: string,
  input: CreateWorkItemRequest,
): Promise<CreatedWorkItem> {
  const res = await apiFetch(`/api/repositories/${repoId}/workitems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(CREATE_FEATURE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res));
  }
  return (await res.json()) as CreatedWorkItem;
}

// Refina o artefato: registra o prompt como comentário e devolve o texto gerado
// pela LLM (sem salvar). Timeout estendido (chamada à LLM).
export async function refineArtifact(
  repoId: string,
  number: number,
  kind: ArtifactKind,
  prompt: string,
  base?: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), LLM_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await apiFetch(`${artifactBase(repoId, number, kind)}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(base === undefined ? { prompt } : { prompt, base }),
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    const json = (await res.json()) as { content?: unknown };
    if (typeof json.content !== 'string') {
      throw new Error('Resposta da API em formato inesperado.');
    }
    return json.content;
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

// Salva o artefato (commit do arquivo) e devolve o WorkItemView atualizado.
export async function saveArtifact(
  repoId: string,
  number: number,
  kind: ArtifactKind,
  content: string,
): Promise<WorkItemView> {
  return postForView(`${artifactBase(repoId, number, kind)}/save`, { content }, REQUEST_TIMEOUT_MS);
}

// Salva uma edição parcial (título/descrição) e devolve o WorkItemView atualizado.
// Mesmo scaffolding de timeout/abort do fetchWorkItem; PATCH com corpo JSON.
export async function saveWorkItem(
  repoId: string,
  level: Level,
  number: number,
  patch: WorkItemPatch,
  signal?: AbortSignal,
): Promise<WorkItemView> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await apiFetch(`/api/repositories/${repoId}/workitems/${level}/${number}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    const json: unknown = await res.json();
    if (!isWorkItemView(json)) {
      throw new Error('Resposta da API em formato inesperado.');
    }
    return json;
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
