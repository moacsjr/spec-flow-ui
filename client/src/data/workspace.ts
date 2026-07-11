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
  input: { title: string; dueOn?: string | null },
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
  patch: { title?: string; dueOn?: string | null; state?: 'open' | 'closed' },
): Promise<void> {
  await request(`/api/repositories/${repoId}/milestones/${milestoneNumber}`, {
    method: 'PATCH',
    payload: patch,
  });
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
