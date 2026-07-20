// Navegação hierárquica do repositório: ao clicar num repositório conectado, a
// PRIMEIRA tela é a lista de INICIATIVAS; clicar numa iniciativa lista os seus
// ÉPICOS; clicar num épico entra no drill já existente (Épico → Features →
// Stories → Tasks, tela de work item). Tudo derivado do snapshot (client-side).
//
// Repositório sem iniciativas cai direto na lista de épicos (hierarquias
// antigas continuam navegáveis); épicos órfãos (sem iniciativa-pai) aparecem
// numa seção própria para nada ficar inacessível.

import { useMemo } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import { useProjectSnapshot } from '../hooks/useProjectSnapshot';
import { typeSlug } from '../lib/workItemType';
import { DASHBOARD_HREF, hrefForInitiatives, hrefForItem } from '../lib/router';
import { STATUS_MAP } from '../lib/status';

interface HierarchyScreenProps {
  repoId: string;
  number: number | null; // null = lista de iniciativas; n = épicos da iniciativa
}

function GridSkeleton() {
  return (
    <div className="repo-grid" aria-busy="true" aria-label="Carregando hierarquia">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

// Card de um nó (iniciativa ou épico), no visual dos cards de épico.
function NodeCard({
  item,
  href,
  childrenLabel,
  childrenCount,
}: {
  item: SnapshotItem;
  href: string;
  childrenLabel: string;
  childrenCount: number;
}) {
  const done = item.state === 'closed' || item.stage === 'Done';
  const style = done ? STATUS_MAP.done : STATUS_MAP.prog;
  const progress = item.progress;
  return (
    <a className="feature-card feature-card-link" href={href}>
      <div className="feature-card__top">
        <span className="feature-card__dot" style={{ background: style.color }} />
        <span className="feature-card__name" title={item.title}>
          {item.title}
        </span>
      </div>
      <div className="feature-card__footer">
        <div className="tags">
          <span className="tag">#{item.number}</span>
          <span className="tag">
            {childrenCount} {childrenLabel}
          </span>
        </div>
        <div className="feature-card__meta">
          <span className="status-badge" style={{ color: style.color, background: style.bg }}>
            {done
              ? 'Concluída'
              : progress && progress.total > 0
                ? `${progress.completed}/${progress.total}`
                : 'Aberta'}
          </span>
        </div>
      </div>
    </a>
  );
}

export function HierarchyScreen({ repoId, number }: HierarchyScreenProps) {
  const { state, retry } = useProjectSnapshot(repoId);
  const snapshot = state.phase === 'ready' ? state.snapshot : null;

  const initiatives = useMemo(
    () => (snapshot ? snapshot.items.filter((i) => typeSlug(i) === 'initiative') : []),
    [snapshot],
  );
  const epics = useMemo(
    () => (snapshot ? snapshot.items.filter((i) => typeSlug(i) === 'epic') : []),
    [snapshot],
  );
  const childCount = (n: number, slug: string) =>
    snapshot ? snapshot.items.filter((i) => i.parentNumber === n && typeSlug(i) === slug).length : 0;

  const node = number != null ? initiatives.find((i) => i.number === number) ?? null : null;
  const nodeEpics = node ? epics.filter((e) => e.parentNumber === node.number) : [];
  const orphanEpics = epics.filter(
    (e) => !initiatives.some((i) => i.number === e.parentNumber),
  );

  const repoName = snapshot?.repository.name ?? '…';
  // Sem iniciativas no repositório → a lista raiz mostra os épicos direto.
  const rootHasInitiatives = initiatives.length > 0;

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
            {node ? (
              <>
                <a className="breadcrumb__seg" href={hrefForInitiatives(repoId)}>
                  {repoName}
                </a>
                <span className="breadcrumb__sep">/</span>
                <span className="breadcrumb__seg breadcrumb__seg--current">{node.title}</span>
              </>
            ) : (
              <span className="breadcrumb__seg breadcrumb__seg--current">{repoName}</span>
            )}
          </nav>
        </div>
      </header>

      <main className="page">
        <div className="dashboard__head">
          <h1 className="dashboard__title">
            {node ? `Épicos de ${node.title}` : rootHasInitiatives ? 'Iniciativas' : 'Épicos'}
          </h1>
        </div>

        {state.phase === 'loading' && <GridSkeleton />}

        {state.phase === 'error' && (
          <div className="repo-empty">
            <div className="repo-empty__art" aria-hidden="true">⚠️</div>
            <p className="repo-empty__title">Falha ao carregar a hierarquia</p>
            <p>
              <code>{state.message}</code>
            </p>
            <button type="button" className="btn btn--accent" onClick={retry}>
              Tentar novamente
            </button>
          </div>
        )}

        {snapshot && number != null && !node && (
          <div className="repo-empty">
            <div className="repo-empty__art" aria-hidden="true">📭</div>
            <p className="repo-empty__title">Iniciativa #{number} não encontrada</p>
            <a className="btn btn--accent" href={hrefForInitiatives(repoId)}>
              Ver iniciativas
            </a>
          </div>
        )}

        {/* Épicos de uma iniciativa */}
        {snapshot && node && (
          nodeEpics.length === 0 ? (
            <div className="repo-empty">
              <div className="repo-empty__art" aria-hidden="true">📭</div>
              <p className="repo-empty__title">Esta iniciativa ainda não tem épicos</p>
            </div>
          ) : (
            <div className="repo-grid">
              {nodeEpics.map((epic) => (
                <NodeCard
                  key={epic.number}
                  item={epic}
                  href={hrefForItem(repoId, 'epic', epic.number)}
                  childrenLabel="features"
                  childrenCount={childCount(epic.number, 'feature')}
                />
              ))}
            </div>
          )
        )}

        {/* Raiz: iniciativas (ou épicos, quando o repo não usa iniciativas) */}
        {snapshot && number == null && (
          <>
            {rootHasInitiatives ? (
              <div className="repo-grid">
                {initiatives.map((ini) => (
                  <NodeCard
                    key={ini.number}
                    item={ini}
                    href={hrefForInitiatives(repoId, ini.number)}
                    childrenLabel="épicos"
                    childrenCount={childCount(ini.number, 'epic')}
                  />
                ))}
              </div>
            ) : epics.length > 0 ? (
              <div className="repo-grid">
                {epics.map((epic) => (
                  <NodeCard
                    key={epic.number}
                    item={epic}
                    href={hrefForItem(repoId, 'epic', epic.number)}
                    childrenLabel="features"
                    childrenCount={childCount(epic.number, 'feature')}
                  />
                ))}
              </div>
            ) : (
              <div className="repo-empty">
                <div className="repo-empty__art" aria-hidden="true">📭</div>
                <p className="repo-empty__title">Nenhuma iniciativa ou épico neste repositório</p>
              </div>
            )}

            {/* Épicos fora de iniciativas — nada fica inacessível */}
            {rootHasInitiatives && orphanEpics.length > 0 && (
              <>
                <div className="dashboard__head" style={{ marginTop: 24 }}>
                  <h1 className="dashboard__title">Épicos sem iniciativa</h1>
                </div>
                <div className="repo-grid">
                  {orphanEpics.map((epic) => (
                    <NodeCard
                      key={epic.number}
                      item={epic}
                      href={hrefForItem(repoId, 'epic', epic.number)}
                      childrenLabel="features"
                      childrenCount={childCount(epic.number, 'feature')}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
