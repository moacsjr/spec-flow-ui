import type { ChildItem, Status } from '@spec-flow/shared';

export interface StatusStyle {
  color: string; // CSS var
  bg: string; // CSS var
  label: string;
}

// Mapa de status → estilo (RFC seção 5).
export const STATUS_MAP: Record<Status, StatusStyle> = {
  done: { color: 'var(--done)', bg: 'var(--done-bg)', label: 'Concluída' },
  prog: { color: 'var(--accent)', bg: 'var(--accent-soft)', label: 'Em andamento' },
  todo: { color: 'var(--todo)', bg: 'var(--todo-bg)', label: 'A fazer' },
};

export interface Legend {
  done: number;
  prog: number;
  todo: number;
}

// Contagens por categoria, derivadas do pct dos filhos (RFC seção 5).
export function legendCounts(items: ChildItem[]): Legend {
  return items.reduce<Legend>(
    (acc, it) => {
      if (it.pct >= 100) acc.done += 1;
      else if (it.pct > 0) acc.prog += 1;
      else acc.todo += 1;
      return acc;
    },
    { done: 0, prog: 0, todo: 0 },
  );
}
