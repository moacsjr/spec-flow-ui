// Fonte de dados do Dashboard — consome GET /api/repositories do backend
// (Express + SQLite). Em dev, o Vite faz proxy de /api para a porta 3001
// (veja vite.config.ts). Timeout de 10s (spec — caso de erro "Timeout").

import type { Repository } from '@spec-flow/shared';

const REQUEST_TIMEOUT_MS = 10_000;

function isRepository(value: unknown): value is Repository {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'number' &&
    typeof r.name === 'string' &&
    typeof r.url === 'string' &&
    typeof r.createdAt === 'string'
  );
}

export async function fetchRepositories(signal?: AbortSignal): Promise<Repository[]> {
  // Aborta por timeout OU pelo signal externo (troca de rota / unmount).
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onExternalAbort = () => timeout.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch('/api/repositories', {
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!res.ok) {
      throw new Error(`Falha ao carregar dados (HTTP ${res.status}).`);
    }
    const json: unknown = await res.json();
    if (!Array.isArray(json) || !json.every(isRepository)) {
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
