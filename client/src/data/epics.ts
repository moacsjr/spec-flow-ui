// Fonte de dados da tela de épicos — consome GET /api/repositories/:id/epics.
// O backend faz a integração com o GitHub; aqui só exibimos. Em dev, o Vite faz
// proxy de /api para a porta 3001 (veja vite.config.ts).

import type { RepositoryEpics } from '@spec-flow/shared';

const REQUEST_TIMEOUT_MS = 10_000;

function isRepositoryEpics(value: unknown): value is RepositoryEpics {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.repository === 'object' &&
    v.repository !== null &&
    Array.isArray(v.epics)
  );
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string') return body.error;
  } catch {
    /* corpo não-JSON */
  }
  return `Falha ao carregar os épicos (HTTP ${res.status}).`;
}

export async function fetchRepositoryEpics(
  repoId: number,
  signal?: AbortSignal,
): Promise<RepositoryEpics> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(`/api/repositories/${repoId}/epics`, {
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(await errorMessage(res));
    }
    const json: unknown = await res.json();
    if (!isRepositoryEpics(json)) {
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
