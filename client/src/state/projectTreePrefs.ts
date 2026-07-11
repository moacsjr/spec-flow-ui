// Preferências locais da árvore da tela Project (nós colapsados), por repositório.
// Puramente client-side (localStorage) — mesmo padrão namespaced/try-catch do
// WorkspaceContext. Set<number> é serializado como array (não é JSON-serializável).

const STORAGE_KEY = 'spec-flow.project-tree';

interface Persisted {
  collapsed?: Record<string, number[]>; // repoId → números colapsados
}

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
export function readCollapsed(repoId: string): Set<number> {
  const list = readPersisted().collapsed?.[repoId] ?? [];
  return new Set(list.filter((n) => typeof n === 'number'));
}

export function writeCollapsed(repoId: string, collapsed: Set<number>): void {
  const current = readPersisted().collapsed ?? {};
  writePersisted({ collapsed: { ...current, [repoId]: [...collapsed] } });
}
