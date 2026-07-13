// Fila de trabalho (RFC-003): lista de SnapshotItems com badges (etapa,
// prioridade, milestone), assignee, PRs vinculados e ações por linha. É o
// bloco de construção da maioria das páginas de workspace.

import type { ReactNode } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import { hrefForItem } from '../../lib/router';
import { progressPct, waitingSince } from '../../lib/workspaceSelectors';
import { typeOf, typeSlug } from '../../lib/workItemType';

export interface RowAction {
  label: string;
  onClick?: () => void;
  href?: string; // âncora (drill-down / GitHub); ignorado se onClick presente
  accent?: boolean;
  disabled?: boolean;
}

interface QueueListProps {
  repoId: string;
  items: SnapshotItem[];
  empty: string; // mensagem do estado vazio
  showPrs?: boolean; // exibe chips de PR (Code Review / Development)
  showProgress?: boolean; // exibe % derivado do subIssuesSummary
  meta?: (item: SnapshotItem) => ReactNode; // conteúdo extra por linha
  actions?: (item: SnapshotItem) => RowAction[];
}

// Drill-down interno para epic/feature/story; task/unknown vão ao GitHub.
function itemHref(repoId: string, item: SnapshotItem): { href: string; external: boolean } {
  if (item.level === 'epic' || item.level === 'feature' || item.level === 'story') {
    return { href: hrefForItem(repoId, item.level, item.number), external: false };
  }
  return { href: item.url, external: true };
}

function initialsOf(login: string): string {
  return login.slice(0, 2).toUpperCase();
}

export function QueueList({
  repoId,
  items,
  empty,
  showPrs,
  showProgress,
  meta,
  actions,
}: QueueListProps) {
  if (items.length === 0) {
    return <p className="queue__empty">{empty}</p>;
  }

  return (
    <ul className="queue">
      {items.map((item) => {
        const { href, external } = itemHref(repoId, item);
        const pct = showProgress ? progressPct(item) : null;
        return (
          <li key={item.number} className="queue__row">
            <div className="queue__main">
              <span className={`queue__level queue__level--${typeSlug(item)}`}>
                {typeOf(item)}
              </span>
              <a
                className="queue__title"
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                <span className="queue__number">#{item.number}</span> {item.title}
              </a>
              <span className="queue__badges">
                {item.priority && (
                  <span className={`chip chip--${item.priority.toLowerCase()}`}>{item.priority}</span>
                )}
                {item.stage && <span className="chip chip--stage">{item.stage}</span>}
                {item.area && <span className="chip">{item.area}</span>}
                {item.milestone && <span className="chip chip--milestone">🗓 {item.milestone.title}</span>}
                {item.state === 'closed' && <span className="chip chip--closed">fechada</span>}
              </span>
            </div>

            <div className="queue__side">
              {pct !== null && (
                <span className="queue__pct" title={`${item.progress?.completed}/${item.progress?.total} tasks`}>
                  {pct}%
                </span>
              )}
              {item.assignees[0] && (
                <span
                  className="queue__assignee"
                  title={item.assignees[0].name ?? item.assignees[0].login}
                >
                  {initialsOf(item.assignees[0].login)}
                </span>
              )}
              {meta?.(item)}
            </div>

            {showPrs && item.prs.length > 0 && (
              <div className="queue__prs">
                {item.prs.map((pr) => (
                  <a
                    key={pr.number}
                    className={`prchip prchip--${pr.state}${pr.isDraft ? ' prchip--draft' : ''}`}
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer"
                    title={pr.title}
                  >
                    PR #{pr.number} · {pr.isDraft ? 'draft' : pr.state}
                    {pr.state === 'open' && !pr.isDraft && pr.reviewDecision !== 'APPROVED' && (
                      <> · esperando {waitingSince(pr.createdAt)}</>
                    )}
                    {pr.reviewers.length > 0 && <> · rev: {pr.reviewers.join(', ')}</>}
                  </a>
                ))}
              </div>
            )}

            {actions && actions(item).length > 0 && (
              <div className="queue__actions">
                {actions(item).map((action) =>
                  action.onClick || !action.href ? (
                    <button
                      key={action.label}
                      type="button"
                      className={`btn btn--sm${action.accent ? ' btn--accent' : ''}`}
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      {action.label}
                    </button>
                  ) : (
                    <a
                      key={action.label}
                      className={`btn btn--sm${action.accent ? ' btn--accent' : ''}`}
                      href={action.href}
                      {...(action.href.startsWith('http')
                        ? { target: '_blank', rel: 'noreferrer' }
                        : {})}
                    >
                      {action.label}
                    </a>
                  ),
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
