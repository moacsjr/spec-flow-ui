// Dashboard — página inicial (Story #3 / Task #5). Lista os repositórios
// conectados em grid responsivo (1 coluna no mobile, 3 no desktop), com busca
// client-side por nome e os estados de loading / vazio / erro.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRepositories } from '../hooks/useRepositories';
import { useMe } from '../hooks/useMe';
import { RepositoryCard } from './RepositoryCard';
import { ToastStack, useToasts } from './workspace/Toasts';
import { startGitHubAppInstall } from '../data/github';
import { hrefForWorkspace } from '../lib/router';
import { lastWorkspaceRole } from '../state/WorkspaceContext';

// Rota futura para conectar/adicionar um repositório (ainda não implementada).
const CONNECT_HREF = '#/repositories/new';

function RepoGridSkeleton() {
  // 5 skeletons durante o loading (critério de aceite).
  return (
    <div className="repo-grid" aria-busy="true" aria-label="Carregando repositórios">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

function EmptyState({ isRoot }: { isRoot: boolean }) {
  return (
    <div className="repo-empty">
      <div className="repo-empty__art" aria-hidden="true">📭</div>
      <p className="repo-empty__title">Nenhum repositório encontrado</p>
      {isRoot ? (
        <a className="btn btn--accent" href={CONNECT_HREF}>
          Adicionar repositório
        </a>
      ) : (
        <p>Peça a um administrador para conectar um repositório ou atribuir seus papéis.</p>
      )}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="repo-empty">
      <div className="repo-empty__art" aria-hidden="true">⚠️</div>
      <p className="repo-empty__title">Falha ao carregar dados</p>
      <button type="button" className="btn btn--accent" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

export function DashboardPage() {
  const { state, retry } = useRepositories();
  const { me } = useMe();
  const [query, setQuery] = useState('');
  const { toasts, addToast, dismissToast } = useToasts();
  const warnedLogin = useRef(false);
  // Gestão de repositórios/GitHub App é administração — só o root (owner) vê.
  const isRoot = me?.isRoot ?? false;

  // Sem login do GitHub vinculado → alerta com a instrução de configuração
  // (uma vez por visita ao dashboard).
  useEffect(() => {
    if (me && !me.login && !warnedLogin.current) {
      warnedLogin.current = true;
      addToast(
        'Você ainda não vinculou o seu login do GitHub — configure-o para que os workspaces reconheçam seus itens e PRs.',
        { label: 'Configurar', run: () => window.location.assign('#/settings') },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const repositories = state.phase === 'ready' ? state.repositories : [];

  // Filtro client-side por nome (case-insensitive), em tempo real.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repositories;
    return repositories.filter((r) => r.name.toLowerCase().includes(q));
  }, [repositories, query]);

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <span className="brand" aria-hidden="true" />
          <nav className="breadcrumb" aria-label="Navegação">
            <span className="breadcrumb__seg breadcrumb__seg--current">Dashboard</span>
          </nav>
        </div>
        <div className="topbar__right">
          <a className="btn btn--accent" href={hrefForWorkspace(lastWorkspaceRole())}>
            Abrir workspace
          </a>
          <a className="btn" href="#/settings">
            Configurações
          </a>
          {isRoot && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  startGitHubAppInstall().catch((err: Error) => alert(err.message));
                }}
              >
                Instalar GitHub App
              </button>
              <a className="btn btn--accent" href={CONNECT_HREF}>
                Conectar novo repositório
              </a>
            </>
          )}
        </div>
      </header>

      <main className="page">
        <div className="dashboard__head">
          <h1 className="dashboard__title">Repositórios Conectados</h1>
          {state.phase === 'ready' && repositories.length > 0 && (
            <input
              type="search"
              className="dashboard__search"
              placeholder="Buscar por nome…"
              aria-label="Buscar repositórios por nome"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>

        {state.phase === 'loading' && <RepoGridSkeleton />}

        {state.phase === 'error' && <ErrorState onRetry={retry} />}

        {state.phase === 'ready' &&
          (repositories.length === 0 ? (
            <EmptyState isRoot={isRoot} />
          ) : filtered.length === 0 ? (
            <div className="repo-empty">
              <p className="repo-empty__title">Nenhum repositório corresponde a “{query}”.</p>
            </div>
          ) : (
            <div className="repo-grid">
              {filtered.map((repo) => (
                <RepositoryCard key={repo.id} repo={repo} />
              ))}
            </div>
          ))}
      </main>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
