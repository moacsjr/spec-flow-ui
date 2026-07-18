// Anatomia compartilhada das telas de execução do TL (spec "Telas de execução"):
// Stories e Bugs (Tasks nunca aparecem), agrupados por milestone (ETA asc, "Sem
// milestone" ao final, colapso persistido), linha padrão (tipo, item, feature,
// pts, responsável, tempo-na-etapa com limiares) e faixa de insight aritmético.

import { useEffect, useState, type ReactNode } from 'react';
import type { MilestoneSummary, SnapshotItem, StageName } from '@spec-flow/shared';
import { typeSlug, itemsByNumber, parentOf } from '../../../lib/workItemType';
import { fetchStageAges, type StageAge } from '../../../data/workspace';

const DAY = 86_400_000;
const COLLAPSE_KEY = 'spec-flow.exec-collapse';

export const isExecItem = (i: SnapshotItem): boolean =>
  typeSlug(i) === 'story' || typeSlug(i) === 'bug';

export function daysFrom(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

// ---- idades por etapa ----
export function useStageAges(repoId: string, stage: StageName, refreshKey: string) {
  const [ages, setAges] = useState<Map<number, StageAge>>(new Map());
  useEffect(() => {
    fetchStageAges(repoId, stage)
      .then((list) => setAges(new Map(list.map((a) => [a.number, a]))))
      .catch(() => undefined);
  }, [repoId, stage, refreshKey]);
  return ages;
}

// ---- colapso por milestone (persistido por repo+tela) ----
export function useGroupCollapse(repoId: string, screen: string) {
  const storageKey = `${COLLAPSE_KEY}.${screen}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const all = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      return new Set(all[repoId] ?? []);
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        const raw = localStorage.getItem(storageKey);
        const all = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
        localStorage.setItem(storageKey, JSON.stringify({ ...all, [repoId]: [...next] }));
      } catch {
        /* storage indisponível */
      }
      return next;
    });
  return { collapsed, toggle };
}

// ---- agrupamento por milestone (ETA asc; Sem milestone ao final) ----
export interface ExecGroup {
  key: string;
  title: string | null;
  items: SnapshotItem[];
}

export function groupByMilestoneEta(
  items: SnapshotItem[],
  milestones: MilestoneSummary[],
): ExecGroup[] {
  const open = [...milestones].sort((a, b) => ((a.dueOn ?? '9999') < (b.dueOn ?? '9999') ? -1 : 1));
  const byMilestone = new Map<number | null, SnapshotItem[]>();
  for (const item of items) {
    const key = item.milestone?.number ?? null;
    const bucket = byMilestone.get(key);
    if (bucket) bucket.push(item);
    else byMilestone.set(key, [item]);
  }
  const sortItems = (list: SnapshotItem[]) =>
    list.sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || (a.createdAt < b.createdAt ? -1 : 1);
    });
  const out: ExecGroup[] = [];
  for (const m of open) {
    const list = byMilestone.get(m.number);
    if (list?.length) out.push({ key: `m${m.number}`, title: m.title, items: sortItems(list) });
  }
  const none = byMilestone.get(null);
  if (none?.length) out.push({ key: 'none', title: null, items: sortItems(none) });
  return out;
}

// ---- células padrão ----

export function TypeBadgeExec({ item }: { item: SnapshotItem }) {
  const slug = typeSlug(item);
  return (
    <span className={`proj-badge proj-badge--${slug}`}>{slug === 'bug' ? 'BUG' : 'STORY'}</span>
  );
}

export function TimeCell({
  age,
  warnDays,
}: {
  age: StageAge | undefined;
  warnDays: number;
}) {
  if (!age) return <span className="pl2-dim">—</span>;
  const days = daysFrom(age.at);
  const cls =
    days > warnDays * 2 ? ' ex-time--danger' : days > warnDays ? ' ex-time--warn' : '';
  return (
    <span className={`mono ex-time${cls}`} title={age.approximate ? 'Entrada na etapa estimada' : undefined}>
      {age.approximate ? '~' : ''}
      {days}d
    </span>
  );
}

export function AssigneeCell({ item }: { item: SnapshotItem }) {
  const a = item.assignees[0];
  if (!a) return <span className="pl2-dim">—</span>;
  return (
    <span className="ex-assignee" title={a.name ?? a.login}>
      <span className="ex-assignee__av">{a.login.slice(0, 2).toUpperCase()}</span>
      {a.login}
    </span>
  );
}

export function featureOf(
  item: SnapshotItem,
  byNumber: Map<number, SnapshotItem>,
): SnapshotItem | null {
  const parent = parentOf(item, byNumber);
  return parent && typeSlug(parent) === 'feature' ? parent : parent;
}

// ---- grupos com colapso (wrapper de layout) ----

export function ExecGroups({
  groups,
  collapsed,
  onToggle,
  renderRow,
  header,
}: {
  groups: ExecGroup[];
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  renderRow: (item: SnapshotItem) => ReactNode;
  header?: (group: ExecGroup) => ReactNode;
}) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} className="ex-group">
          <button type="button" className="ex-group__head" onClick={() => onToggle(g.key)}>
            <span className="pr-group__chevron">{collapsed.has(g.key) ? '▸' : '▾'}</span>
            <span className="ex-group__title">{g.title ?? 'Sem milestone'}</span>
            <span className="ex-group__count">{g.items.length}</span>
            {header?.(g)}
          </button>
          {!collapsed.has(g.key) && (
            <div className="ex-rows">{g.items.map((item) => renderRow(item))}</div>
          )}
        </section>
      ))}
    </>
  );
}

// Índice número→item reexportado para as telas (feature-pai etc.).
export { itemsByNumber };
