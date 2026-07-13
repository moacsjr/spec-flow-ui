// Router de hash mínimo (sem dependência). Rotas:
//   #/dashboard                 → página inicial (lista de repositórios)
//   #/ws/:role/:page            → workspace por papel (RFC-003: pm | tech | dev)
//   #/repos/:id/epics           → lista de épicos de um repositório
//   #/repos/:id/:level/:number  → work item (epic/feature/story) daquele repo
// A raiz (hash vazio) canoniza para #/dashboard.

import type { Level, WorkspaceRole } from '@spec-flow/shared';

// Rota é uma união discriminada por `view`. Telas de épicos/work item carregam
// o id do repositório (ULID), de onde o backend deriva owner/repo.
export type Route =
  | { view: 'dashboard' }
  | { view: 'repo-new' }
  | { view: 'repo-edit'; repoId: string }
  | { view: 'repo-epics'; repoId: string }
  | { view: 'item'; repoId: string; level: Level; number: number }
  | { view: 'settings' }
  | { view: 'invite'; code: string }
  // Página do workspace ('dashboard', 'backlog'…). Página desconhecida cai no
  // dashboard do papel — validação fica no WorkspaceLayout (que conhece a nav).
  // `query`: filtros opcionais passados no hash (ex.: ?milestone=3).
  | { view: 'workspace'; role: WorkspaceRole; page: string; query?: Record<string, string> };

export const DASHBOARD_ROUTE: Route = { view: 'dashboard' };
export const DASHBOARD_HREF = '#/dashboard';
export const REPO_NEW_HREF = '#/repositories/new';
export const SETTINGS_HREF = '#/settings';
export const hrefForRepoEdit = (repoId: string): string => `#/repositories/${repoId}/edit`;
export const DEFAULT_ROUTE: Route = DASHBOARD_ROUTE;

const LEVELS: Level[] = ['epic', 'feature', 'story'];
const WORKSPACE_ROLES: WorkspaceRole[] = ['pm', 'tech', 'dev'];

function parseQuery(queryStr: string | undefined): Record<string, string> | undefined {
  if (!queryStr) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(queryStr)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

// Faz parse do hash para uma Route. Inválido/vazio → DEFAULT_ROUTE.
export function parseHash(hash: string): Route {
  const [rawPath, queryStr] = hash.replace(/^#\/?/, '').split('?');
  const [a, b, c, d] = rawPath.split('/');

  if (a === 'dashboard') return DASHBOARD_ROUTE;
  if (a === 'settings') return { view: 'settings' };
  if (a === 'invite' && b) return { view: 'invite', code: b };
  if (a === 'ws' && WORKSPACE_ROLES.includes(b as WorkspaceRole)) {
    return {
      view: 'workspace',
      role: b as WorkspaceRole,
      page: c || 'dashboard',
      query: parseQuery(queryStr),
    };
  }
  if (a === 'repositories') {
    if (b === 'new') return { view: 'repo-new' };
    if (b && c === 'edit') return { view: 'repo-edit', repoId: b };
  }

  if (a === 'repos') {
    const repoId = b;
    if (!repoId) return DEFAULT_ROUTE;
    if (c === 'epics') return { view: 'repo-epics', repoId };
    const number = parseInt(d, 10);
    if (LEVELS.includes(c as Level) && Number.isFinite(number)) {
      return { view: 'item', repoId, level: c as Level, number };
    }
  }
  return DEFAULT_ROUTE;
}

// Helpers de href (o esquema de URL é responsabilidade do frontend).
export const hrefForEpics = (repoId: string): string => `#/repos/${repoId}/epics`;
export const hrefForItem = (repoId: string, level: Level, n: number): string =>
  `#/repos/${repoId}/${level}/${n}`;
export const hrefForWorkspace = (
  role: WorkspaceRole,
  page = 'dashboard',
  query?: Record<string, string | number>,
): string => {
  const qs = query
    ? new URLSearchParams(
        Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
      ).toString()
    : '';
  return `#/ws/${role}/${page}${qs ? `?${qs}` : ''}`;
};
