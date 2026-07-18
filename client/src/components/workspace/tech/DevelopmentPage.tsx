// Development do TL (spec "Telas de execução" §3.2): etapa 🚧 Desenvolvimento.
// Colunas extras: progresso de Tasks (k/t) e PRs vinculados. Ação única:
// "Devolver para Ready" (pull por engano/indisponibilidade). O insight mais
// importante do workspace: story em desenvolvimento SEM PR há > 3 dias —
// trabalho invisível que nenhuma outra tela captura.

import { useMemo, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { isOpen } from '../../../lib/workspaceSelectors';
import { returnToReady } from '../../../data/workspace';
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

const WARN_DAYS = 5;
const NO_PR_DAYS = 3;

export function DevelopmentPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const items = useMemo(
    () =>
      snapshot.items.filter(
        (i) => isExecItem(i) && isOpen(i) && i.stage === 'Development' && !removedLocal.has(i.number),
      ),
    [snapshot.items, removedLocal],
  );
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const ages = useStageAges(repoId, 'Development', snapshot.generatedAt);
  const { collapsed, toggle } = useGroupCollapse(repoId, 'development');
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();

  const groups = useMemo(
    () => groupByMilestoneEta(items, snapshot.milestones.filter((m) => m.state === 'open')),
    [items, snapshot.milestones],
  );

  // Insight: stories sem PR vinculado há > 3d na etapa.
  const noPr = (i: SnapshotItem) => {
    const a = ages.get(i.number);
    return i.prs.length === 0 && a != null && daysFrom(a.at) > NO_PR_DAYS;
  };
  const invisibleCount = items.filter(noPr).length;

  const doReturn = (item: SnapshotItem) => {
    if (!confirm(`Devolver #${item.number} para Ready? O responsável será removido.`)) return;
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(item.number));
    returnToReady(repoId, 'story', item.number)
      .then(() => {
        addToast(`#${item.number} devolvida para Ready.`);
        refresh();
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha ao devolver: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => doReturn(item),
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">{items.length} itens em desenvolvimento</span>
      </div>

      {invisibleCount > 0 && (
        <div className="bl-insights pr-insights--danger">
          💡 {invisibleCount} {invisibleCount === 1 ? 'story' : 'stories'} em desenvolvimento sem PR
          há mais de {NO_PR_DAYS} dias.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">🚧</span>
          <p>Nada em desenvolvimento.</p>
          <p className="tl-empty__hint">Os devs puxam do Technical Backlog para cá.</p>
        </div>
      ) : (
        <ExecGroups
          groups={groups}
          collapsed={collapsed}
          onToggle={toggle}
          renderRow={(item) => {
            const feature = featureOf(item, byNumber);
            return (
              <div key={item.number} className={`ex-row${noPr(item) ? ' ex-row--alert' : ''}`}>
                <span className="ex-row__lead">{noPr(item) ? '⚠️' : ''}</span>
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
                <span className="mono ex-row__tasks">
                  {item.progress ? `${item.progress.completed}/${item.progress.total}` : '—'}
                </span>
                <span className="ex-row__prs">
                  {item.prs.length === 0 ? (
                    <span className="pl2-dim">sem PR</span>
                  ) : (
                    item.prs.map((pr) => (
                      <a
                        key={pr.number}
                        className={`prchip prchip--${pr.state}${pr.isDraft ? ' prchip--draft' : ''}`}
                        href={pr.url}
                        target="_blank"
                        rel="noreferrer"
                        title={pr.title}
                      >
                        #{pr.number} {pr.isDraft ? 'draft' : pr.state}
                      </a>
                    ))
                  )}
                </span>
                <span className="mono">{item.points != null ? `${item.points} pts` : '—'}</span>
                <AssigneeCell item={item} />
                <TimeCell age={ages.get(item.number)} warnDays={WARN_DAYS} />
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={() => doReturn(item)}
                >
                  Devolver p/ Ready
                </button>
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
