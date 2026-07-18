// Progress do TL (spec "Telas de execução" §3.5): matriz item × etapa de toda a
// execução (✅ Ready → 🎉 Done), Stories e Bugs por milestone, somente leitura.
// Itens Done permanecem visíveis — a matriz é o retrato completo. O AI Summary
// (sob demanda, cacheado por snapshot) absorve os insights aritméticos.

import { useMemo, useRef, useState } from 'react';
import type { SnapshotItem, StageName } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { fetchProgressSummary } from '../../../data/workspace';
import {
  TypeBadgeExec,
  groupByMilestoneEta,
  isExecItem,
  useGroupCollapse,
} from './executionShared';

const EXEC_STAGES: StageName[] = ['Ready', 'Development', 'Code Review', 'QA', 'UAT', 'Done'];
const STAGE_SHORT: Record<string, string> = {
  Ready: 'Ready',
  Development: 'Dev',
  'Code Review': 'Review',
  QA: 'QA',
  UAT: 'Homolog.',
  Done: 'Done',
};

// Etapa efetiva na matriz: issue fechada conta como Done.
function stageOf(item: SnapshotItem): StageName | null {
  if (item.state === 'closed') return 'Done';
  return item.stage != null && EXEC_STAGES.includes(item.stage) ? item.stage : null;
}

export function TechProgressPage({ repoId, snapshot }: WorkspacePageProps) {
  const items = useMemo(
    () => snapshot.items.filter((i) => isExecItem(i) && stageOf(i) != null),
    [snapshot.items],
  );
  const { collapsed, toggle } = useGroupCollapse(repoId, 'progress');
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);
  const [summaries, setSummaries] = useState<Map<string, string>>(new Map());
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const { toasts, addToast, dismissToast } = useToasts();
  const summaryKey = useRef(snapshot.generatedAt);

  // Cache por snapshot: dados novos invalidam os resumos gerados.
  if (summaryKey.current !== snapshot.generatedAt) {
    summaryKey.current = snapshot.generatedAt;
    if (summaries.size > 0) setSummaries(new Map());
  }

  const groups = useMemo(
    () => groupByMilestoneEta(items, snapshot.milestones.filter((m) => m.state === 'open')),
    [items, snapshot.milestones],
  );

  const genSummary = (groupKey: string, milestoneNumber: number) => {
    setGenerating((s) => new Set(s).add(groupKey));
    fetchProgressSummary(repoId, milestoneNumber)
      .then((content) => setSummaries((m) => new Map(m).set(groupKey, content)))
      .catch((err: Error) => addToast(`Falha ao gerar o resumo: ${err.message}`))
      .finally(() =>
        setGenerating((s) => {
          const next = new Set(s);
          next.delete(groupKey);
          return next;
        }),
      );
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">{items.length} itens em execução (Ready → Done)</span>
      </div>

      {items.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">📈</span>
          <p>Nada em execução ainda.</p>
          <p className="tl-empty__hint">A matriz acompanha as stories de Ready a Done.</p>
        </div>
      ) : (
        groups.map((g) => {
          const counts = EXEC_STAGES.map(
            (s) => g.items.filter((i) => stageOf(i) === s).length,
          );
          const totalPts = g.items.reduce((sum, i) => sum + (i.points ?? 0), 0);
          const donePts = g.items
            .filter((i) => stageOf(i) === 'Done')
            .reduce((sum, i) => sum + (i.points ?? 0), 0);
          const milestoneNumber = g.key === 'none' ? null : Number(g.key.slice(1));
          const summary = summaries.get(g.key);
          return (
            <section key={g.key} className="ex-group">
              <button type="button" className="ex-group__head" onClick={() => toggle(g.key)}>
                <span className="pr-group__chevron">{collapsed.has(g.key) ? '▸' : '▾'}</span>
                <span className="ex-group__title">{g.title ?? 'Sem milestone'}</span>
                <span className="ex-group__count">
                  {donePts}/{totalPts} pts
                </span>
                <span className="ws-toolbar__spacer" />
                <span className="px-widgets">
                  {EXEC_STAGES.map((s, i) => (
                    <span key={s} className="px-widget" title={s}>
                      {STAGE_SHORT[s]} <b>{counts[i]}</b>
                    </span>
                  ))}
                </span>
              </button>

              {!collapsed.has(g.key) && (
                <>
                  {milestoneNumber != null && (
                    <div className="px-summary">
                      {summary ? (
                        <p className="px-summary__text">✨ {summary}</p>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={generating.has(g.key)}
                          onClick={() => genSummary(g.key, milestoneNumber)}
                        >
                          {generating.has(g.key) ? (
                            <>
                              <span className="spinner" aria-hidden="true" /> Gerando resumo…
                            </>
                          ) : (
                            '✨ Gerar resumo'
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="px-matrix">
                    <div className="px-matrix__head">
                      <span />
                      {EXEC_STAGES.map((s) => (
                        <span key={s} className="px-matrix__col">
                          {STAGE_SHORT[s]}
                        </span>
                      ))}
                    </div>
                    {g.items.map((item) => {
                      const st = stageOf(item);
                      return (
                        <div key={item.number} className="px-matrix__row">
                          <button
                            type="button"
                            className="px-matrix__item"
                            onClick={() => setDrawer(item)}
                            title={item.title}
                          >
                            <TypeBadgeExec item={item} />
                            <span className="mono">#{item.number}</span>
                            <span className="px-matrix__title">{item.title}</span>
                          </button>
                          {EXEC_STAGES.map((s) => (
                            <span
                              key={s}
                              className={`px-matrix__cell${st === s ? ' px-matrix__cell--on' : ''}${
                                st === s && s === 'Done' ? ' px-matrix__cell--done' : ''
                              }`}
                            >
                              {st === s ? '●' : ''}
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          );
        })
      )}

      {drawer && <FeatureDrawer repoId={repoId} item={drawer} onClose={() => setDrawer(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
