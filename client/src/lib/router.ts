// Router de hash mínimo (sem dependência). Rotas:
//   #/dashboard                 → página inicial (lista de repositórios)
//   #/repos/:id/epics           → lista de épicos de um repositório
//   #/repos/:id/:level/:number  → work item (epic/feature/story) daquele repo
// A raiz (hash vazio) canoniza para #/dashboard.

import type { Level } from '@spec-flow/shared';

// Rota é uma união discriminada por `view`. Telas de épicos/work item carregam
// o id do repositório (do SQLite), de onde o backend deriva owner/repo.
export type Route =
  | { view: 'dashboard' }
  | { view: 'repo-epics'; repoId: number }
  | { view: 'item'; repoId: number; level: Level; number: number };

export const DASHBOARD_ROUTE: Route = { view: 'dashboard' };
export const DASHBOARD_HREF = '#/dashboard';
export const DEFAULT_ROUTE: Route = DASHBOARD_ROUTE;

const LEVELS: Level[] = ['epic', 'feature', 'story'];

// Faz parse do hash para uma Route. Inválido/vazio → DEFAULT_ROUTE.
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [a, b, c, d] = path.split('/');

  if (a === 'dashboard') return DASHBOARD_ROUTE;

  if (a === 'repos') {
    const repoId = parseInt(b, 10);
    if (!Number.isFinite(repoId)) return DEFAULT_ROUTE;
    if (c === 'epics') return { view: 'repo-epics', repoId };
    const number = parseInt(d, 10);
    if (LEVELS.includes(c as Level) && Number.isFinite(number)) {
      return { view: 'item', repoId, level: c as Level, number };
    }
  }
  return DEFAULT_ROUTE;
}

// Helpers de href (o esquema de URL é responsabilidade do frontend).
export const hrefForEpics = (repoId: number): string => `#/repos/${repoId}/epics`;
export const hrefForItem = (repoId: number, level: Level, n: number): string =>
  `#/repos/${repoId}/${level}/${n}`;
