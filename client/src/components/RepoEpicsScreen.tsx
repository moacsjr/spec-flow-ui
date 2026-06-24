// Tela de épicos de um repositório. Lista os épicos ([EPIC]) retornados pelo
// backend e leva ao work item de cada um. Só exibição.

import { useRepositoryEpics } from '../hooks/useRepositoryEpics';
import { DASHBOARD_HREF } from '../lib/router';
import { EpicCard } from './EpicCard';

interface RepoEpicsScreenProps {
  repoId: number;
}

function EpicsSkeleton() {
  return (
    <div className="repo-grid" aria-busy="true" aria-label="Carregando épicos">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function RepoEpicsScreen({ repoId }: RepoEpicsScreenProps) {
  const { state, retry } = useRepositoryEpics(repoId);
  const repoName = state.phase === 'ready' ? state.data.repository.name : '…';

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          <span className="brand" aria-hidden="true" />
          <nav className="breadcrumb" aria-label="Navegação">
            <a className="breadcrumb__seg" href={DASHBOARD_HREF}>
              Repositórios
            </a>
            <span className="breadcrumb__sep">/</span>
            <span className="breadcrumb__seg breadcrumb__seg--current">{repoName}</span>
          </nav>
        </div>
      </header>

      <main className="page">
        <div className="dashboard__head">
          <h1 className="dashboard__title">Épicos</h1>
        </div>

        {state.phase === 'loading' && <EpicsSkeleton />}

        {state.phase === 'error' && (
          <div className="repo-empty">
            <div className="repo-empty__art" aria-hidden="true">⚠️</div>
            <p className="repo-empty__title">Falha ao carregar os épicos</p>
            <p>
              <code>{state.message}</code>
            </p>
            <button type="button" className="btn btn--accent" onClick={retry}>
              Tentar novamente
            </button>
          </div>
        )}

        {state.phase === 'ready' &&
          (state.data.epics.length === 0 ? (
            <div className="repo-empty">
              <div className="repo-empty__art" aria-hidden="true">📭</div>
              <p className="repo-empty__title">Nenhum épico encontrado neste repositório</p>
            </div>
          ) : (
            <div className="repo-grid">
              {state.data.epics.map((epic) => (
                <EpicCard key={epic.number} repoId={repoId} epic={epic} />
              ))}
            </div>
          ))}
      </main>
    </>
  );
}
