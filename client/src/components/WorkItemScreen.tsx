// Tela de work item (Epic / Feature / Story). Busca o WorkItemView pronto no
// backend (GET /api/repositories/:id/workitems/:level/:number) e renderiza hero
// + descrição + filhos. Toda integração com o GitHub fica no servidor; aqui só
// exibimos. O repoId escopa a busca e os links de drill-down/breadcrumb.

import { useEffect, useState } from 'react';
import type { Level, WorkItemView } from '@spec-flow/shared';
import { fetchWorkItem } from '../data/workItem';
import { DASHBOARD_HREF, hrefForEpics, hrefForItem } from '../lib/router';
import { TopBar, type BreadCrumb } from './TopBar';
import { Hero } from './Hero';
import { Description } from './Description';
import { ItemsPanel } from './ItemsPanel';
import { LoadingState } from './LoadingState';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; view: WorkItemView };

interface WorkItemScreenProps {
  repoId: number;
  level: Level;
  number: number;
}

export function WorkItemScreen({ repoId, level, number }: WorkItemScreenProps) {
  const [state, setState] = useState<State>({ phase: 'loading' });

  // Carrega o item da rota atual. O AbortController cobre o duplo-efeito do
  // StrictMode e evita aplicar estado obsoleto ao trocar de rota.
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    fetchWorkItem(repoId, level, number, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', view });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, [repoId, level, number]);

  if (state.phase === 'loading') {
    return <LoadingState />;
  }

  if (state.phase === 'error') {
    return (
      <div className="state-msg state-msg--error">
        <p>Não foi possível carregar o item.</p>
        <p>
          <code>{state.message}</code>
        </p>
        <p>
          Verifique se o servidor está em execução e se a integração com o GitHub está
          configurada no backend.
        </p>
      </div>
    );
  }

  const { view } = state;

  // Breadcrumb resolvido: Repositórios → Épicos do repo → (ancestrais do adapter).
  // Descarta o 1º crumb 'Épicos' do adapter (sem link) — substituído pelo nosso.
  const breadcrumb: BreadCrumb[] = [
    { label: 'Repositórios', href: DASHBOARD_HREF },
    { label: 'Épicos', href: hrefForEpics(repoId) },
    ...view.breadcrumb.slice(1).map((c) => ({
      label: c.label,
      href: c.to ? hrefForItem(repoId, c.to.level, c.to.number) : undefined,
    })),
  ];

  return (
    <>
      <TopBar breadcrumb={breadcrumb} owner={view.owner} />
      <main className="page">
        <Hero view={view} />
        <div className="body-grid">
          <Description source={view.descriptionMdx} plan={view.planMdx} />
          <ItemsPanel items={view.children} label={view.childrenLabel} repoId={repoId} />
        </div>
      </main>
    </>
  );
}
