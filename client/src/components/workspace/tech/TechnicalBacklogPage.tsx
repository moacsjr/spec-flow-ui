// Technical Backlog do TL (spec "Telas de execução" §3.1): etapa ✅ Ready — a
// vitrine do que está pronto para pull. Ações: Story Points inline (última
// correção barata antes do trabalho) e ordem de pull por drag (campo Rank,
// consumida pela Pending do Developer). Sem movimento de milestone por Story
// (herdado da Feature; mudanças de release são no Planning do PM).

import { useMemo, useState, type DragEvent } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { isOpen } from '../../../lib/workspaceSelectors';
import { setPoints, setRank } from '../../../data/workspace';
import {
  AssigneeCell,
  ExecGroups,
  TimeCell,
  TypeBadgeExec,
  daysFrom,
  featureOf,
  groupByMilestoneEta,
  isExecItem,
  itemsByNumber,
  useGroupCollapse,
  useStageAges,
} from './executionShared';

const WARN_DAYS = 14;
const RANK_STEP = 1000;
const FIB = [1, 2, 3, 5, 8, 13, 21];

export function TechnicalBacklogPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const items = useMemo(
    () => snapshot.items.filter((i) => isExecItem(i) && isOpen(i) && i.stage === 'Ready'),
    [snapshot.items],
  );
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const ages = useStageAges(repoId, 'Ready', snapshot.generatedAt);
  const { collapsed, toggle } = useGroupCollapse(repoId, 'ready');
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);
  const [editingPts, setEditingPts] = useState<number | null>(null);
  const [rankOverride, setRankOverride] = useState<Map<number, number>>(new Map());
  const [drag, setDrag] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ number: number; pos: 'before' | 'after' } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();

  const rankOf = (i: SnapshotItem) => rankOverride.get(i.number) ?? i.rank ?? Number.MAX_SAFE_INTEGER;
  const sorted = useMemo(
    () => [...items].sort((a, b) => rankOf(a) - rankOf(b) || (a.createdAt < b.createdAt ? -1 : 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, rankOverride],
  );
  const groups = useMemo(
    () => groupByMilestoneEta(sorted, snapshot.milestones.filter((m) => m.state === 'open')),
    [sorted, snapshot.milestones],
  );

  const aged = items.filter((i) => {
    const a = ages.get(i.number);
    return a && daysFrom(a.at) > WARN_DAYS;
  }).length;

  const savePoints = (item: SnapshotItem, points: number) => {
    setEditingPts(null);
    setPoints(repoId, 'story', item.number, points)
      .then(() => refresh())
      .catch((err: Error) => addToast(`Falha ao gravar os pontos: ${err.message}`));
  };

  // Ordem de pull: drag dentro do grupo do milestone (rank por ponto médio).
  const onDropRow = (e: DragEvent, target: SnapshotItem) => {
    e.preventDefault();
    const d = drag;
    const at = dropAt;
    setDrag(null);
    setDropAt(null);
    if (d == null || !at || d === target.number) return;
    const dragged = items.find((i) => i.number === d);
    if (!dragged || (dragged.milestone?.number ?? null) !== (target.milestone?.number ?? null)) return;

    const group = sorted.filter(
      (i) => (i.milestone?.number ?? null) === (target.milestone?.number ?? null) && i.number !== d,
    );
    const idx = group.findIndex((i) => i.number === at.number);
    if (idx === -1) return;
    const insert = at.pos === 'before' ? idx : idx + 1;
    const prev = group[insert - 1];
    const next = group[insert];
    const prevRank = prev && rankOf(prev) !== Number.MAX_SAFE_INTEGER ? rankOf(prev) : null;
    const nextRank = next && rankOf(next) !== Number.MAX_SAFE_INTEGER ? rankOf(next) : null;
    const newRank =
      prevRank != null && nextRank != null
        ? (prevRank + nextRank) / 2
        : prevRank != null
          ? prevRank + RANK_STEP
          : nextRank != null
            ? nextRank - RANK_STEP
            : Date.now();

    const prevOverride = rankOverride.get(d);
    setRankOverride((m) => new Map(m).set(d, newRank));
    setBusy(true);
    setRank(repoId, 'story', d, newRank)
      .then(() => refresh())
      .catch((err: Error) => {
        setRankOverride((m) => {
          const nextM = new Map(m);
          if (prevOverride != null) nextM.set(d, prevOverride);
          else nextM.delete(d);
          return nextM;
        });
        addToast(`Falha ao persistir a ordem: ${err.message}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">{items.length} itens prontos para pull</span>
      </div>

      {aged > 0 && (
        <div className="bl-insights">
          💡 {aged} {aged === 1 ? 'item pronto' : 'itens prontos'} sem pull há mais de 2 semanas.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">📦</span>
          <p>Nada pronto para pull.</p>
          <p className="tl-empty__hint">As stories chegam aqui pela decomposição da Plan view.</p>
        </div>
      ) : (
        <ExecGroups
          groups={groups}
          collapsed={collapsed}
          onToggle={toggle}
          renderRow={(item) => {
            const feature = featureOf(item, byNumber);
            const isDrop = dropAt?.number === item.number;
            return (
              <div
                key={item.number}
                className={[
                  'ex-row',
                  drag === item.number ? 'pr-row--dragging' : '',
                  isDrop && dropAt?.pos === 'before' ? 'pr-row--insert-before' : '',
                  isDrop && dropAt?.pos === 'after' ? 'pr-row--insert-after' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onDragOver={(e) => {
                  if (drag == null || drag === item.number) return;
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropAt({
                    number: item.number,
                    pos: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
                  });
                }}
                onDragLeave={() => dropAt?.number === item.number && setDropAt(null)}
                onDrop={(e) => onDropRow(e, item)}
              >
                <span
                  className="pr-row__grip"
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDrag(item.number);
                  }}
                  onDragEnd={() => {
                    setDrag(null);
                    setDropAt(null);
                  }}
                  title="Arraste para definir a ordem de pull"
                >
                  ⠿
                </span>
                <TypeBadgeExec item={item} />
                <button type="button" className="ex-row__title" onClick={() => setDrawer(item)} title={item.title}>
                  <span className="mono">#{item.number}</span> {item.title}
                </button>
                <button
                  type="button"
                  className="ex-row__feature"
                  onClick={() => feature && setDrawer(feature)}
                  title={feature?.title}
                >
                  {feature?.title ?? '—'}
                </button>
                {editingPts === item.number ? (
                  <select
                    className="queue__priosel"
                    autoFocus
                    value={item.points ?? 3}
                    onChange={(e) => savePoints(item, Number(e.target.value))}
                    onBlur={() => setEditingPts(null)}
                    aria-label="Story Points"
                  >
                    {FIB.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="ex-row__pts mono"
                    onClick={() => setEditingPts(item.number)}
                    title="Clique para editar os pontos"
                  >
                    {item.points ?? '—'} pts
                  </button>
                )}
                <AssigneeCell item={item} />
                <TimeCell age={ages.get(item.number)} warnDays={WARN_DAYS} />
              </div>
            );
          }}
        />
      )}

      {drawer && <FeatureDrawer repoId={repoId} item={drawer} onClose={() => setDrawer(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
