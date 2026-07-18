// Code Review do TL (spec "Telas de execução" §3.3): etapa 👀 Code Review — o
// radar. O review acontece no GitHub; aqui não há escrita. O que envelhece é o
// pedido ao humano: a espera conta desde a criação do PR (aproximação de
// reviewRequestedAt — o snapshot não expõe o timestamp do request).

import { useMemo, useState } from 'react';
import type { PullRequestRef, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { isOpen } from '../../../lib/workspaceSelectors';
import {
  AssigneeCell,
  ExecGroups,
  TypeBadgeExec,
  daysFrom,
  featureOf,
  groupByMilestoneEta,
  isExecItem,
  itemsByNumber,
  useGroupCollapse,
} from './executionShared';

const WAIT_WARN = 2;
const WAIT_DANGER = 5;

// PR "quente" da linha: o aberto mais antigo (é o que espera review).
function hotPr(item: SnapshotItem): PullRequestRef | null {
  const open = item.prs.filter((p) => p.state === 'open' && !p.isDraft);
  if (open.length === 0) return item.prs[0] ?? null;
  return open.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
}

export function TechCodeReviewPage({ repoId, snapshot }: WorkspacePageProps) {
  const items = useMemo(
    () => snapshot.items.filter((i) => isExecItem(i) && isOpen(i) && i.stage === 'Code Review'),
    [snapshot.items],
  );
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const { collapsed, toggle } = useGroupCollapse(repoId, 'code-review');
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);

  const groups = useMemo(
    () => groupByMilestoneEta(items, snapshot.milestones.filter((m) => m.state === 'open')),
    [items, snapshot.milestones],
  );

  const waiting = items.filter((i) => {
    const pr = hotPr(i);
    return pr && pr.state === 'open' && daysFrom(pr.createdAt) > WAIT_WARN;
  }).length;

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">{items.length} itens em code review</span>
      </div>

      {waiting > 0 && (
        <div className="bl-insights">
          💡 {waiting} {waiting === 1 ? 'PR esperando' : 'PRs esperando'} review há mais de{' '}
          {WAIT_WARN} dias.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">👀</span>
          <p>Nenhum PR em review.</p>
          <p className="tl-empty__hint">As stories chegam aqui do Desenvolvimento.</p>
        </div>
      ) : (
        <ExecGroups
          groups={groups}
          collapsed={collapsed}
          onToggle={toggle}
          renderRow={(item) => {
            const feature = featureOf(item, byNumber);
            const pr = hotPr(item);
            const waitDays = pr && pr.state === 'open' ? daysFrom(pr.createdAt) : null;
            const waitCls =
              waitDays != null && waitDays > WAIT_DANGER
                ? ' ex-time--danger'
                : waitDays != null && waitDays > WAIT_WARN
                  ? ' ex-time--warn'
                  : '';
            const reviewer = pr?.reviewers[0] ?? null;
            const changesRequested = pr?.reviewDecision === 'CHANGES_REQUESTED';
            return (
              <div key={item.number} className="ex-row">
                <span className="ex-row__lead" />
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
                <span className="ex-row__prs">
                  {pr ? (
                    <a
                      className={`prchip prchip--${pr.state}`}
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      title={pr.title}
                    >
                      PR #{pr.number}
                    </a>
                  ) : (
                    <span className="pl2-dim">sem PR</span>
                  )}
                  {changesRequested && <span className="ex-badge-changes">mudanças pedidas</span>}
                </span>
                <span className={reviewer ? 'ex-reviewer' : 'ex-reviewer ex-reviewer--none'}>
                  {reviewer ?? 'sem reviewer'}
                </span>
                <span className="mono">{item.points != null ? `${item.points} pts` : '—'}</span>
                <AssigneeCell item={item} />
                <span className={`mono ex-time${waitCls}`} title="Espera desde a abertura do PR">
                  {waitDays != null ? `${waitDays}d` : '—'}
                </span>
              </div>
            );
          }}
        />
      )}

      {drawer && <FeatureDrawer repoId={repoId} item={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
