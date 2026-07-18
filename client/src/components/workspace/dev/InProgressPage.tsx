// In Progress do Developer (spec "Workspace do Developer" §3.3): cards de
// trabalho (não linhas de varredura) dos itens em 🚧 Desenvolvimento — meus por
// padrão, com toggle "ver todas do time" persistido. Tasks checáveis inline
// (marcar fecha a issue da Task; o progresso sobe em cascata), PRs vinculados,
// badge de retorno do QA com o motivo, e os fallbacks manuais da automação:
// "Enviar para review" e "Devolver para Ready" (só itens meus).

import { useEffect, useMemo, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { isOpen } from '../../../lib/workspaceSelectors';
import {
  fetchQaReturnInfo,
  returnToReady,
  setStage,
  setTaskState,
  type QaReturnInfo,
} from '../../../data/workspace';
import {
  TimeCell,
  TypeBadgeExec,
  daysFrom,
  featureOf,
  isExecItem,
  itemsByNumber,
  useStageAges,
} from '../tech/executionShared';
import { DevGate, isMine, useTeamToggle } from './devShared';

const NO_PR_DAYS = 3;
const WARN_DAYS = 5;

export function InProgressPage({ repoId, snapshot, milestoneNumber, refresh }: WorkspacePageProps) {
  const { showAll, toggle } = useTeamToggle(repoId, 'in-progress');
  const [movedLocal, setMovedLocal] = useState<Set<number>>(new Set());
  const [taskOverride, setTaskOverride] = useState<Map<number, boolean>>(new Map());
  const [qaReturns, setQaReturns] = useState<Map<number, QaReturnInfo>>(new Map());
  const [qaOpen, setQaOpen] = useState<Set<number>>(new Set());
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const ages = useStageAges(repoId, 'Development', snapshot.generatedAt);

  const inDev = useMemo(
    () =>
      snapshot.items.filter(
        (i) =>
          isExecItem(i) &&
          isOpen(i) &&
          i.stage === 'Development' &&
          i.milestone?.number === milestoneNumber &&
          !movedLocal.has(i.number),
      ),
    [snapshot.items, milestoneNumber, movedLocal],
  );

  // Badge "Retornou do QA": consulta best-effort por card visível.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      inDev.map((i) =>
        fetchQaReturnInfo(repoId, i.number)
          .then((info) => [i.number, info] as const)
          .catch(() => [i.number, null] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      const next = new Map<number, QaReturnInfo>();
      for (const [n, info] of pairs) if (info) next.set(n, info);
      setQaReturns(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, snapshot.generatedAt, inDev.length]);

  const tasksOf = (item: SnapshotItem): SnapshotItem[] =>
    snapshot.items
      .filter((t) => t.parentNumber === item.number && t.level === 'task')
      .sort((a, b) => a.number - b.number);

  const taskDone = (t: SnapshotItem): boolean => taskOverride.get(t.number) ?? t.state === 'closed';

  const toggleTask = (t: SnapshotItem) => {
    const next = !taskDone(t);
    setTaskOverride((m) => new Map(m).set(t.number, next));
    setTaskState(repoId, t.number, next)
      .then(() => refresh())
      .catch((err: Error) => {
        setTaskOverride((m) => {
          const rollback = new Map(m);
          rollback.delete(t.number);
          return rollback;
        });
        addToast(`Falha ao ${next ? 'concluir' : 'reabrir'} a task #${t.number}: ${err.message}`);
      });
  };

  const moveOut = (item: SnapshotItem, label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    setMovedLocal((s) => new Set(s).add(item.number));
    run()
      .then(() => {
        addToast(`#${item.number} ${label}.`);
        refresh();
      })
      .catch((err: Error) => {
        setMovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha em #${item.number}: ${err.message}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <DevGate snapshot={snapshot} milestoneNumber={milestoneNumber}>
      {(login) => {
        const items = showAll ? inDev : inDev.filter((i) => isMine(i, login));

        // Insight pessoal: meu item sem PR há mais de 3 dias na etapa.
        const stuck = inDev.filter((i) => {
          const a = ages.get(i.number);
          return (
            isMine(i, login) && i.prs.length === 0 && a != null && daysFrom(a.at) > NO_PR_DAYS
          );
        });

        return (
          <div className="ws-page">
            <div className="bl-head">
              <span className="bl-head__count">
                {items.length} {items.length === 1 ? 'item' : 'itens'} em desenvolvimento
                {showAll ? ' (time)' : ' (meus)'}
              </span>
              <span className="ws-toolbar__spacer" />
              <label className="dv-toggle">
                <input type="checkbox" checked={showAll} onChange={toggle} /> ver todas do time
              </label>
            </div>

            {stuck.length > 0 && (
              <div className="bl-insights pr-insights--danger">
                💡 #{stuck[0].number} está há {daysFrom(ages.get(stuck[0].number)?.at ?? '')}d sem
                PR — precisa de ajuda?
                {stuck.length > 1 && ` (+${stuck.length - 1} nessa situação)`}
              </div>
            )}

            {items.length === 0 ? (
              <div className="bl-empty">
                <span className="bl-empty__icon">🚧</span>
                <p>{showAll ? 'Nada em desenvolvimento neste milestone.' : 'Nada seu em andamento.'}</p>
                <p className="tl-empty__hint">Puxe o próximo item na view Pending.</p>
              </div>
            ) : (
              <div className="dv-cards">
                {items.map((item) => {
                  const feature = featureOf(item, byNumber);
                  const tasks = tasksOf(item);
                  const done = tasks.filter(taskDone).length;
                  const qa = qaReturns.get(item.number);
                  const mine = isMine(item, login);
                  return (
                    <article key={item.number} className="dv-card-item">
                      <header className="dv-card-item__head">
                        <TypeBadgeExec item={item} />
                        <button
                          type="button"
                          className="ex-row__title"
                          onClick={() => setDrawer(item)}
                          title={item.title}
                        >
                          <span className="mono">#{item.number}</span> {item.title}
                        </button>
                        {qa && (
                          <button
                            type="button"
                            className="dv-qa-badge"
                            onClick={() =>
                              setQaOpen((s) => {
                                const next = new Set(s);
                                if (next.has(item.number)) next.delete(item.number);
                                else next.add(item.number);
                                return next;
                              })
                            }
                            title={`Este item voltou ${qa.origin === 'uat' ? 'da Homologação (PM)' : 'do QA (TL)'} — clique para ver o motivo`}
                          >
                            ↩ retornou {qa.origin === 'uat' ? 'da homologação' : 'do QA'}
                          </button>
                        )}
                      </header>

                      <div className="dv-card-item__meta">
                        <button
                          type="button"
                          className="ex-row__feature"
                          onClick={() => feature && setDrawer(feature)}
                          title={feature?.title}
                        >
                          {feature?.title ?? '—'}
                        </button>
                        <span className="mono">{item.points != null ? `${item.points} pts` : '—'}</span>
                        <span className="mono dv-card-item__tasksum">
                          {tasks.length > 0 ? `${done}/${tasks.length} tasks` : 'sem tasks'}
                        </span>
                        <TimeCell age={ages.get(item.number)} warnDays={WARN_DAYS} />
                        {!mine && item.assignees[0] && (
                          <span className="pl2-dim">@{item.assignees[0].login}</span>
                        )}
                      </div>

                      {qa && qaOpen.has(item.number) && (
                        <div className="dv-qa-reason">{qa.reason}</div>
                      )}

                      {tasks.length > 0 && (
                        <ul className="dv-tasklist">
                          {tasks.map((t) => (
                            <li key={t.number}>
                              <label className={taskDone(t) ? 'dv-task dv-task--done' : 'dv-task'}>
                                <input
                                  type="checkbox"
                                  checked={taskDone(t)}
                                  disabled={!mine}
                                  onChange={() => toggleTask(t)}
                                />
                                <span className="mono">#{t.number}</span> {t.title}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}

                      <footer className="dv-card-item__foot">
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
                        <span className="ws-toolbar__spacer" />
                        {mine && (
                          <>
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={busy}
                              title="Fallback manual da automação — para trabalho sem PR"
                              onClick={() =>
                                moveOut(item, 'enviada para Code Review', () =>
                                  setStage(repoId, 'story', item.number, 'Code Review'),
                                )
                              }
                            >
                              Enviar p/ review
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Devolver #${item.number} para Ready? O responsável será removido.`,
                                  )
                                ) {
                                  moveOut(item, 'devolvida para Ready', () =>
                                    returnToReady(repoId, 'story', item.number),
                                  );
                                }
                              }}
                            >
                              Devolver p/ Ready
                            </button>
                          </>
                        )}
                      </footer>
                    </article>
                  );
                })}
              </div>
            )}

            {drawer && <FeatureDrawer repoId={repoId} item={drawer} onClose={() => setDrawer(null)} />}
            <ToastStack toasts={toasts} onDismiss={dismissToast} />
          </div>
        );
      }}
    </DevGate>
  );
}
