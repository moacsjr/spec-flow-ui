// Prioritization do PM (RFC-003 §2): itens já priorizados, agrupados P0→P3, em
// formato de tabela. Cada linha mostra o Épico a que o item pertence (coluna
// Epic). Ações: trocar prioridade (move entre grupos) e Send to Specification
// (Features: aplica spec-wave:spec + move a etapa). "Business Value" não tem
// fonte no MVP — a ordenação disponível é prioridade/data de criação.

import { useMemo, useState } from 'react';
import type { Priority, SnapshotItem } from '@spec-flow/shared';
import { PRIORITIES } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { ItemTable, type Column } from '../ItemTable';
import { TypeBadge } from '../TypeBadge';
import { byPriority, isBacklogLevel, isOpen } from '../../../lib/workspaceSelectors';
import { ancestorOfType, itemsByNumber } from '../../../lib/workItemType';
import { hrefForItem } from '../../../lib/router';
import { setPriority } from '../../../data/workspace';
import { createArtifact } from '../../../data/workItem';

const PRIORITY_TITLES: Record<Priority, string> = {
  P0: 'P0 — Crítica',
  P1: 'P1 — Alta',
  P2: 'P2 — Média',
  P3: 'P3 — Baixa',
};

function itemHref(repoId: string, item: SnapshotItem): { href: string; external: boolean } {
  if (item.level === 'epic' || item.level === 'feature' || item.level === 'story') {
    return { href: hrefForItem(repoId, item.level, item.number), external: false };
  }
  return { href: item.url, external: true };
}

export function PrioritizationPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [sort, setSort] = useState<'priority' | 'created'>('priority');
  const [busy, setBusy] = useState(false);

  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);

  const prioritized = useMemo(
    () =>
      snapshot.items
        .filter((item) => isBacklogLevel(item) && isOpen(item) && item.priority !== null)
        .sort(sort === 'priority' ? byPriority : (a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [snapshot.items, sort],
  );

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .then(() => refresh())
      .catch((err: Error) => alert(err.message))
      .finally(() => setBusy(false));
  };

  const columns: Column[] = [
    {
      header: 'Issue Id',
      className: 'proj-table__id',
      cell: (item) => {
        const { href, external } = itemHref(repoId, item);
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
            #{item.number}
          </a>
        );
      },
    },
    { header: 'Issue Type', cell: (item) => <TypeBadge item={item} /> },
    {
      header: 'Epic',
      cell: (item) => {
        const epic = ancestorOfType(item, byNumber, 'epic');
        return epic ? (
          <span className="proj-table__parent">
            <span className="proj-table__parentnum">#{epic.number}</span> {epic.title}
          </span>
        ) : (
          '—'
        );
      },
    },
    {
      header: 'Etapa',
      cell: (item) =>
        item.stageRaw ?? item.stage ? (
          <span className="chip chip--stage">{item.stageRaw ?? item.stage}</span>
        ) : (
          '—'
        ),
    },
    {
      header: 'Title',
      className: 'proj-table__title',
      cell: (item) => {
        const { href, external } = itemHref(repoId, item);
        return (
          <a
            className="proj-table__titlelink"
            href={href}
            {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {item.title}
          </a>
        );
      },
    },
    {
      header: 'Prioridade',
      cell: (item) => (
        <select
          className="queue__priosel"
          value={item.priority ?? ''}
          disabled={busy}
          onChange={(e) =>
            run(() =>
              setPriority(
                repoId,
                item.level,
                item.number,
                (e.target.value || null) as Priority | null,
              ),
            )
          }
          aria-label={`Prioridade de #${item.number}`}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="">Remover prioridade</option>
        </select>
      ),
    },
    {
      header: 'Ações',
      className: 'proj-table__actions',
      cell: (item) =>
        item.level === 'feature' && item.stage !== 'Spec' ? (
          <button
            type="button"
            className="btn btn--sm btn--accent"
            disabled={busy}
            onClick={() => run(() => createArtifact(repoId, item.number, 'spec'))}
          >
            Send to Specification
          </button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="ws-page">
      <div className="ws-toolbar">
        <label className="ws-toolbar__label">
          Ordenar por{' '}
          <select value={sort} onChange={(e) => setSort(e.target.value as 'priority' | 'created')}>
            <option value="priority">Prioridade</option>
            <option value="created">Data de criação</option>
          </select>
        </label>
      </div>

      {PRIORITIES.map((priority) => {
        const group = prioritized.filter((item) => item.priority === priority);
        if (group.length === 0) return null;
        return (
          <section key={priority} className="ws-section">
            <h3 className={`ws-section__title prio prio--${priority.toLowerCase()}`}>
              {PRIORITY_TITLES[priority]} <span className="ws-section__count">{group.length}</span>
            </h3>
            <ItemTable items={group} columns={columns} empty="" />
          </section>
        );
      })}

      {prioritized.length === 0 && (
        <p className="queue__empty">Nada priorizado ainda — defina prioridades no Backlog.</p>
      )}
    </div>
  );
}
