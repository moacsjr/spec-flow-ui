// Helpers de status PUROS usados pelo adapter (sem CSS/DOM — isso fica no client).

import type { ChildItem, Status } from '@spec-flow/shared';

// Rótulos legíveis por status (RFC seção 5). O client tem seu próprio STATUS_MAP
// com cores; aqui só precisamos do texto para o hero.
export const STATUS_LABELS: Record<Status, string> = {
  done: 'Concluída',
  prog: 'Em andamento',
  todo: 'A fazer',
};

// Deriva o status de um item a partir do seu percentual.
export function statusFromPct(pct: number): Status {
  if (pct >= 100) return 'done';
  if (pct > 0) return 'prog';
  return 'todo';
}

// Média simples dos % dos filhos, arredondada. Regra do épico (RFC seção 5).
export function meanPct(items: ChildItem[]): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, it) => acc + it.pct, 0);
  return Math.round(sum / items.length);
}
