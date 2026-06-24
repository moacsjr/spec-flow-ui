// Dashboard — página inicial (Story #3 / Task #5). Lista os repositórios
// conectados em grid responsivo (1 coluna no mobile, 3 no desktop), com busca
// client-side por nome e os estados de loading / vazio / erro.

import { useMemo, useState } from 'react';
import { useRepositories } from '../hooks/useRepositories';
import { RepositoryCard } from './RepositoryCard';

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

function EmptyState() {
  return (
    <div className="repo-empty">
      <div className="repo-empty__art" aria-hidden="true">📭</div>
      <p className="repo-empty__title">Nenhum repositório encontrado</p>
      <a className="btn btn--accent" href={CONNECT_HREF}>
        Adicionar repositório
      </a>
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
  const [query, setQuery] = useState('');

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
          <a className="btn btn--accent" href={CONNECT_HREF}>
            Conectar novo repositório
          </a>
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
            <EmptyState />
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
    </>
  );
}
