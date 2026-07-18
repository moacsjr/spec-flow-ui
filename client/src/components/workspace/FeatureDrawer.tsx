// Drawer compacto de um work item (interino — a Feature View completa tem spec
// própria). Aberto pelo clique no título nas telas de Backlog e Prioritization;
// fechar preserva o scroll e o estado da tela (não há navegação).

import { useEffect, useState } from 'react';
import type { Level, SnapshotItem, WorkItemView } from '@spec-flow/shared';
import { Mdx } from '../Mdx';
import { hrefForItem } from '../../lib/router';
import { typeSlug } from '../../lib/workItemType';
import { fetchWorkItem } from '../../data/workItem';

const DAY = 86_400_000;

function ageDays(item: SnapshotItem): number {
  const ms = Date.now() - Date.parse(item.createdAt);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

// Level válido para rotas de work item (Spike herda 'feature' na inferência).
function levelOf(item: SnapshotItem): Level {
  return item.level === 'epic' || item.level === 'story' ? item.level : 'feature';
}

export function FeatureDrawer({
  repoId,
  item,
  onClose,
}: {
  repoId: string;
  item: SnapshotItem;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; view: WorkItemView }
  >({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    fetchWorkItem(repoId, levelOf(item), item.number, controller.signal)
      .then((view) => setState({ phase: 'ready', view }))
      .catch((err: Error) => {
        if (!controller.signal.aborted) setState({ phase: 'error', message: err.message });
      });
    return () => controller.abort();
  }, [repoId, item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const slug = typeSlug(item);

  return (
    <>
      <div className="bl-drawer-backdrop" onMouseDown={onClose} />
      <aside className="bl-drawer" role="dialog" aria-label={`Item #${item.number}`}>
        <div className="bl-drawer__head">
          <span className={`proj-badge proj-badge--${slug}`}>
            {slug === 'spike' ? 'SPIKE' : 'FEAT'}
          </span>
          <span className="bl-drawer__title">
            <span className="mono">#{item.number}</span> {item.title}
          </span>
          <button type="button" className="bl-drawer__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="bl-drawer__meta">
          {item.area && <span className="chip">{item.area}</span>}
          {(item.stageRaw ?? item.stage) && (
            <span className="chip chip--stage">{item.stageRaw ?? item.stage}</span>
          )}
          {item.priority && (
            <span className={`chip chip--${item.priority.toLowerCase()}`}>{item.priority}</span>
          )}
          <span className="chip">{ageDays(item)}d de vida</span>
        </div>

        <div className="bl-drawer__body">
          {state.phase === 'loading' && (
            <p className="bl-drawer__loading">
              <span className="spinner" aria-hidden="true" /> Carregando…
            </p>
          )}
          {state.phase === 'error' && <p className="ai-panel__error">{state.message}</p>}
          {state.phase === 'ready' &&
            (state.view.descriptionMdx ? (
              <Mdx source={state.view.descriptionMdx} />
            ) : (
              <p className="bl-drawer__loading">Sem descrição.</p>
            ))}
        </div>

        <div className="bl-drawer__foot">
          <a className="btn" href={hrefForItem(repoId, levelOf(item), item.number)}>
            Abrir página completa →
          </a>
        </div>
      </aside>
    </>
  );
}
