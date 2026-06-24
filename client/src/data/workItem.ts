// Fonte de dados das telas de work item — consome GET /api/workitems/:level/:number
// do backend, que faz toda a integração com o GitHub e devolve o WorkItemView
// pronto para exibição. O frontend não conhece token nem a forma das issues.
// Em dev, o Vite faz proxy de /api para a porta 3001 (veja vite.config.ts).

import type { Level, WorkItemView } from '@spec-flow/shared';

const REQUEST_TIMEOUT_MS = 10_000;

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
  repoId: number,
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
    const res = await fetch(`/api/repositories/${repoId}/workitems/${level}/${number}`, {
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
