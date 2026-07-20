// Topbar do workspace (RFC-003 §5): seletor de repositório (= projeto no MVP),
// switcher de papel, milestone corrente (papel dev), busca global e
// notificações — ambas derivadas do snapshot (client-side, MVP).

import { useMemo, useState } from 'react';
import type { ProjectSnapshot, Repository, SnapshotItem, WorkspaceRole } from '@spec-flow/shared';
import { hrefForItem, hrefForWorkspace } from '../../lib/router';
import { isWorkspacePage, ROLE_LABELS } from '../../lib/workspaceNav';
import { waitingReview, waitingSince } from '../../lib/workspaceSelectors';
import { useMe } from '../../hooks/useMe';
import { prWaitingMyReview } from './dev/devShared';

interface WorkspaceTopbarProps {
  role: WorkspaceRole;
  page: string;
  repositories: Repository[];
  repoId: string | null;
  onRepoChange: (id: string) => void;
  snapshot: ProjectSnapshot | null;
  milestoneNumber: number | null;
  onMilestoneChange: (n: number | null) => void;
  refreshing: boolean;
  onRefresh: () => void;
}

function searchHref(repoId: string, item: SnapshotItem): string {
  return item.level === 'epic' || item.level === 'feature' || item.level === 'story'
    ? hrefForItem(repoId, item.level, item.number)
    : item.url;
}

// Notificações derivadas: PRs esperando MEU review (primeiro — é o que devo aos
// outros), PRs com mudanças pedidas e PRs esperando review.
function deriveNotifications(
  snapshot: ProjectSnapshot | null,
  myLogin: string | null,
): { text: string; href: string }[] {
  if (!snapshot) return [];
  const mine: { text: string; href: string }[] = [];
  const notes: { text: string; href: string }[] = [];
  for (const item of snapshot.items) {
    if (item.state !== 'open') continue;
    for (const pr of item.prs) {
      if (pr.state !== 'open') continue;
      if (myLogin && prWaitingMyReview(pr, myLogin)) {
        mine.push({
          text: `PR #${pr.number} esperando o SEU review — ${item.title}`,
          href: pr.url,
        });
      } else if (pr.reviewDecision === 'CHANGES_REQUESTED') {
        notes.push({ text: `PR #${pr.number} com mudanças pedidas — ${item.title}`, href: pr.url });
      } else if (!pr.isDraft && pr.reviewDecision !== 'APPROVED' && waitingReview(item)) {
        notes.push({
          text: `PR #${pr.number} esperando review há ${waitingSince(pr.createdAt)} — ${item.title}`,
          href: pr.url,
        });
      }
    }
  }
  return [...mine, ...notes].slice(0, 12);
}

export function WorkspaceTopbar({
  role,
  page,
  repositories,
  repoId,
  onRepoChange,
  snapshot,
  milestoneNumber,
  onMilestoneChange,
  refreshing,
  onRefresh,
}: WorkspaceTopbarProps) {
  const [query, setQuery] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const { me } = useMe();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !snapshot || !repoId) return [];
    return snapshot.items
      .filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          `#${item.number}`.includes(q) ||
          item.labels.some((l) => l.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [query, snapshot, repoId]);

  const notifications = useMemo(
    () => deriveNotifications(snapshot, me?.login ?? null),
    [snapshot, me],
  );
  const openMilestones = snapshot?.milestones.filter((m) => m.state === 'open') ?? [];

  return (
    <header className="ws-topbar">
      <select
        className="ws-topbar__repo"
        value={repoId ?? ''}
        onChange={(e) => onRepoChange(e.target.value)}
        aria-label="Repositório"
      >
        {!repoId && <option value="">Selecione um repositório…</option>}
        {repositories.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repo.name}
          </option>
        ))}
      </select>

      {role === 'dev' && (
        <select
          className="ws-topbar__milestone"
          value={milestoneNumber ?? ''}
          onChange={(e) => e.target.value && onMilestoneChange(Number(e.target.value))}
          aria-label="Milestone corrente"
        >
          {milestoneNumber == null && <option value="">Selecione um milestone…</option>}
          {openMilestones.map((m) => (
            <option key={m.number} value={m.number}>
              {m.title}
            </option>
          ))}
        </select>
      )}

      <div className="ws-topbar__search">
        <input
          type="search"
          placeholder="Buscar no projeto…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Busca global"
        />
        {results.length > 0 && repoId && (
          <ul className="ws-topbar__results">
            {results.map((item) => (
              <li key={item.number}>
                <a href={searchHref(repoId, item)} onClick={() => setQuery('')}>
                  <span className="queue__number">#{item.number}</span> {item.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <span className="ws-topbar__spacer" />

      <button
        type="button"
        className="btn btn--sm"
        onClick={onRefresh}
        disabled={refreshing}
        title="Recarregar dados do GitHub"
      >
        {refreshing ? '⟳ Atualizando…' : '⟳'}
      </button>

      <div className="ws-topbar__notes">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setShowNotes((v) => !v)}
          aria-expanded={showNotes}
          title="Notificações"
        >
          🔔{notifications.length > 0 && <span className="ws-topbar__badge">{notifications.length}</span>}
        </button>
        {showNotes && (
          <ul className="ws-topbar__results ws-topbar__results--notes">
            {notifications.length === 0 && <li className="ws-topbar__empty">Sem notificações.</li>}
            {notifications.map((note) => (
              <li key={note.text}>
                <a href={note.href} target="_blank" rel="noreferrer">
                  {note.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(() => {
        // Papéis reais (spec Gestão de usuários §4.1): o switcher exibe apenas
        // os papéis possuídos no repositório corrente; um papel só → sem
        // switcher. Root (ou modo de transição) vê os três.
        const owned =
          me?.enforced && !me.isRoot && repoId
            ? ((me.roles.find((r) => r.repoId === repoId)?.roles ?? []) as WorkspaceRole[])
            : (Object.keys(ROLE_LABELS) as WorkspaceRole[]);
        if (owned.length === 1) {
          return <span className="ws-topbar__rolefixed">{ROLE_LABELS[owned[0]]}</span>;
        }
        return (
          <select
            className="ws-topbar__role"
            value={role}
            onChange={(e) => {
              const next = e.target.value as WorkspaceRole;
              // Mantém a página na troca de papel quando ela existe no destino;
              // senão cai no dashboard do papel.
              window.location.hash = hrefForWorkspace(
                next,
                isWorkspacePage(next, page) ? page : 'dashboard',
              );
            }}
            aria-label="Papel"
          >
            {(owned.length > 0 ? owned : (Object.keys(ROLE_LABELS) as WorkspaceRole[])).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        );
      })()}
    </header>
  );
}
