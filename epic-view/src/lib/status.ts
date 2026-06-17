import type { Feature, Status } from '../types';

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

// Deriva o status de uma feature a partir do seu percentual.
export function statusFromPct(pct: number): Status {
  if (pct >= 100) return 'done';
  if (pct > 0) return 'prog';
  return 'todo';
}

// epicPct = média simples dos % das features, arredondada (RFC seção 5).
export function epicPct(features: Feature[]): number {
  if (features.length === 0) return 0;
  const sum = features.reduce((acc, f) => acc + f.pct, 0);
  return Math.round(sum / features.length);
}

export interface Legend {
  done: number;
  prog: number;
  todo: number;
}

// legend = contagens por categoria, derivadas do pct (RFC seção 5).
export function legendCounts(features: Feature[]): Legend {
  return features.reduce<Legend>(
    (acc, f) => {
      if (f.pct >= 100) acc.done += 1;
      else if (f.pct > 0) acc.prog += 1;
      else acc.todo += 1;
      return acc;
    },
    { done: 0, prog: 0, todo: 0 },
  );
}
