// Preferências locais de árvores colapsáveis (nós colapsados), por repositório
// e por tela ("scope": Project e Backlog têm árvores independentes). Puramente
// client-side (localStorage) — mesmo padrão namespaced/try-catch do
// WorkspaceContext. Set<number> é serializado como array (não é JSON-serializável).

const STORAGE_KEY = 'spec-flow.project-tree';

// Telas com árvore própria. 'project' mantém a chave legada `collapsed`.
export type TreeScope = 'project' | 'backlog';

interface Persisted {
  collapsed?: Record<string, number[]>; // scope 'project': repoId → colapsados (chave legada)
  backlogCollapsed?: Record<string, number[]>; // scope 'backlog': repoId → colapsados
}

const FIELD_BY_SCOPE: Record<TreeScope, keyof Persisted> = {
  project: 'collapsed',
  backlog: 'backlogCollapsed',
};

function readPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function writePersisted(patch: Persisted): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPersisted(), ...patch }));
  } catch {
    /* storage indisponível (modo privado) — estado só em memória */
  }
}

// Nós colapsados de um repositório (vazio se nunca gravado).
export function readCollapsed(repoId: string, scope: TreeScope = 'project'): Set<number> {
  const list = readPersisted()[FIELD_BY_SCOPE[scope]]?.[repoId] ?? [];
  return new Set(list.filter((n) => typeof n === 'number'));
}

export function writeCollapsed(
  repoId: string,
  collapsed: Set<number>,
  scope: TreeScope = 'project',
): void {
  const field = FIELD_BY_SCOPE[scope];
  const current = readPersisted()[field] ?? {};
  writePersisted({ [field]: { ...current, [repoId]: [...collapsed] } });
}
