// Tela de work item (Epic / Feature / Story). Busca o WorkItemView pronto no
// backend (GET /api/repositories/:id/workitems/:level/:number) e renderiza hero
// + descrição + filhos. Toda integração com o GitHub fica no servidor; aqui só
// exibimos. O repoId escopa a busca e os links de drill-down/breadcrumb.

import { useCallback, useEffect, useState } from 'react';
import type { CreateFeatureRequest, Level, WorkItemPatch, WorkItemView } from '@spec-flow/shared';
import { createFeature, fetchWorkItem, saveWorkItem } from '../data/workItem';
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

// Auto-refresh da Story enquanto o dev-agent trabalha. Cadência de 1 min: cada
// tick recarrega a issue via GraphQL do GitHub — intervalos curtos estouram o
// rate limit da API. Teto de 30 tentativas ≈ 30 min de auto-refresh.
const STORY_POLL_INTERVAL_MS = 60_000;
const STORY_POLL_MAX_ATTEMPTS = 30;

interface WorkItemScreenProps {
  repoId: string;
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

  // Salva uma edição parcial e troca a view pela versão atualizada do backend.
  // Repassa o erro para o componente filho exibir feedback inline e seguir em
  // modo de edição.
  const handleSave = useCallback(
    async (patch: WorkItemPatch) => {
      const updated = await saveWorkItem(repoId, level, number, patch);
      setState({ phase: 'ready', view: updated });
    },
    [repoId, level, number],
  );

  // Substitui a view pela versão recebida (usada pelo fluxo de spec/plan:
  // create/save devolvem o WorkItemView, e o poll da geração atualiza por aqui).
  const applyView = useCallback((view: WorkItemView) => {
    setState({ phase: 'ready', view });
  }, []);

  // Cria uma Feature sob o épico atual e troca a view pelo épico recarregado
  // (com a nova feature na lista). Só faz sentido na Epic View — ver render.
  const handleCreateFeature = useCallback(
    async (input: CreateFeatureRequest) => {
      const updated = await createFeature(repoId, number, input);
      setState({ phase: 'ready', view: updated });
    },
    [repoId, number],
  );

  // Story "em voo" pelo dev-agent: label spec-wave:dev-agent aplicado (aguardando)
  // ou já "Em andamento", e ainda não concluída. Enquanto isso, faz auto-refresh.
  const activeStory =
    state.phase === 'ready' &&
    state.view.level === 'story' &&
    state.view.devStatus !== 'done' &&
    (state.view.devStatus === 'prog' || state.view.devAgentRequested === true);

  // Auto-refresh enquanto o dev-agent trabalha: re-busca a view para refletir —
  // sem refresh manual — o progresso das Tasks (barras animadas) e a transição da
  // própria Story (Aguardando → Em andamento). Para ao concluir (devStatus 'done'),
  // ao sair da rota, ou após o teto de tentativas.
  useEffect(() => {
    if (!activeStory) return;
    let attempts = 0;
    let stopped = false;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        const fresh = await fetchWorkItem(repoId, level, number);
        if (!stopped) setState({ phase: 'ready', view: fresh });
      } catch {
        /* transitório: tenta de novo no próximo tick */
      }
      if (attempts >= STORY_POLL_MAX_ATTEMPTS && !stopped) {
        stopped = true;
        clearInterval(timer);
      }
    }, STORY_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeStory, repoId, level, number]);

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
        <Hero
          view={view}
          repoId={repoId}
          number={number}
          applyView={applyView}
          onSave={handleSave}
        />
        <div className="body-grid">
          <Description
            level={view.level}
            repoId={repoId}
            number={number}
            source={view.descriptionMdx}
            spec={view.specMdx}
            plan={view.planMdx}
            planApproved={view.planApproved}
            onSave={handleSave}
            applyView={applyView}
          />
          <ItemsPanel
            items={view.children}
            label={view.childrenLabel}
            repoId={repoId}
            onCreate={view.level === 'epic' ? handleCreateFeature : undefined}
          />
        </div>
      </main>
    </>
  );
}
