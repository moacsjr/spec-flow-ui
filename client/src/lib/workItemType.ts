// Tipo de work item (Initiative → Epic → Feature → Story → Task…) derivado dos
// labels de tipo do spec-wave (`[INITIATIVE]`, `[EPIC]`, …), com fallback no
// `level` inferido do snapshot. O `level` do snapshot só distingue epic/feature/
// story/task — Initiative fica como `unknown` —, então para telas que precisam
// separar Initiative de Epic (Backlog, Prioritization, Planning) usamos o label.
//
// Helpers centralizados aqui para as páginas do workspace compartilharem a mesma
// regra (evita divergência entre ProjectPage e as filas do PM).

import type { SnapshotItem, WorkItemType } from '@spec-flow/shared';
import { WORK_ITEM_TYPES } from '@spec-flow/shared';

// Label de tipo → rótulo de exibição.
const TYPE_LABELS: Record<string, string> = {
  '[INITIATIVE]': 'Initiative',
  '[EPIC]': 'Epic',
  '[FEATURE]': 'Feature',
  '[STORY]': 'Story',
  '[TASK]': 'Task',
  '[BUG]': 'Bug',
  '[SPIKE]': 'Spike',
  '[RFC]': 'RFC',
};

// Rótulo de exibição do tipo: prioriza o label de tipo do spec-wave; cai no
// level inferido; `—` quando indeterminado.
export function typeOf(item: SnapshotItem): string {
  for (const label of item.labels) {
    if (TYPE_LABELS[label]) return TYPE_LABELS[label];
  }
  if (item.level === 'unknown') return '—';
  return item.level.charAt(0).toUpperCase() + item.level.slice(1);
}

// Slug canônico do tipo (`initiative`/`epic`/…) para classes CSS e comparações.
// `unknown` quando o tipo não é reconhecido.
export function typeSlug(item: SnapshotItem): string {
  const t = typeOf(item).toLowerCase();
  return (WORK_ITEM_TYPES as string[]).includes(t) ? t : 'unknown';
}

// Tipo canônico p/ regras de hierarquia; null quando indeterminado.
export function asType(item: SnapshotItem): WorkItemType | null {
  const slug = typeSlug(item);
  return (WORK_ITEM_TYPES as string[]).includes(slug) ? (slug as WorkItemType) : null;
}

// Índice número → item, para resolver pais/ancestrais por `parentNumber`.
export function itemsByNumber(items: SnapshotItem[]): Map<number, SnapshotItem> {
  return new Map(items.map((i) => [i.number, i]));
}

// Pai direto (via parentNumber); null se ausente ou fora do snapshot.
export function parentOf(
  item: SnapshotItem,
  byNumber: Map<number, SnapshotItem>,
): SnapshotItem | null {
  return item.parentNumber != null ? byNumber.get(item.parentNumber) ?? null : null;
}

// Ancestral do tipo `slug` (ex.: 'epic', 'initiative') subindo por parentNumber.
// null quando não há ancestral desse tipo. `maxHops` limita a busca (a cadeia
// tem no máximo 5 níveis).
export function ancestorOfType(
  item: SnapshotItem,
  byNumber: Map<number, SnapshotItem>,
  slug: string,
  maxHops = 6,
): SnapshotItem | null {
  let current: SnapshotItem | null = item;
  for (let hop = 0; current && hop < maxHops; hop += 1) {
    const parent = parentOf(current, byNumber);
    if (!parent) return null;
    if (typeSlug(parent) === slug) return parent;
    current = parent;
  }
  return null;
}

// `item` descende de `ancestorNumber` (em qualquer nível acima)? Sobe pela cadeia
// de parentNumber até achar o ancestral ou esgotar `maxHops`.
export function isDescendantOf(
  item: SnapshotItem,
  ancestorNumber: number,
  byNumber: Map<number, SnapshotItem>,
  maxHops = 8,
): boolean {
  let current: SnapshotItem | null = item;
  for (let hop = 0; current && hop < maxHops; hop += 1) {
    if (current.parentNumber == null) return false;
    if (current.parentNumber === ancestorNumber) return true;
    current = byNumber.get(current.parentNumber) ?? null;
  }
  return false;
}
