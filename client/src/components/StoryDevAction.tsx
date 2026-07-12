// CTA principal da Story View, dentro do card de progresso. Só aparece quando a
// Story está na etapa "🚧 Desenvolvimento" do board (campo Etapa) — em qualquer
// outra etapa não renderiza nada. Dentro da etapa, três estados derivados do
// WorkItemView da Story:
//   • devStatus 'prog'      → barra animada ("Desenvolvimento em andamento")
//   • devAgentRequested     → "Aguardando Agente IA" (label já aplicado)
//   • devStatus 'todo'      → botão "Iniciar Desenvolvimento" (aplica o label)
// Ao clicar, aplica spec-wave:dev-agent e troca a view — o próprio re-render
// passa a mostrar "Aguardando Agente IA" (sem polling: o label é imediato).

// A etapa vem com prefixo de emoji (ex.: "🚧 Desenvolvimento"); casamos pelo
// nome para tolerar variações do emoji.
function isDevelopmentStage(stage: string | null | undefined): boolean {
  return /desenvolvimento/i.test(stage ?? '');
}

import { useState } from 'react';
import type { WorkItemView } from '@spec-flow/shared';
import { startDevelopment } from '../data/workItem';
import { EditError } from './EditControls';

interface StoryDevActionProps {
  repoId: string;
  number: number;
  view: WorkItemView;
  applyView: (view: WorkItemView) => void;
}

export function StoryDevAction({ repoId, number, view, applyView }: StoryDevActionProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fora da etapa "🚧 Desenvolvimento": não mostra a CTA (nem botão, nem
  // "Aguardando Agente IA", nem barra de andamento).
  if (!isDevelopmentStage(view.devStage)) return null;

  // Concluída: nada a fazer (ignora um label spec-wave:dev-agent que tenha ficado).
  if (view.devStatus === 'done') return null;

  // Em andamento: barra indeterminada (o agente de IA está trabalhando).
  if (view.devStatus === 'prog') {
    return (
      <div className="dev-cta">
        <div className="task-running" role="status" aria-label="Desenvolvimento em andamento">
          <div className="task-running__bar" />
        </div>
        <span className="dev-cta__hint">Desenvolvimento em andamento…</span>
      </div>
    );
  }

  // Label aplicado: aguardando o agente de IA assumir a Story.
  if (view.devAgentRequested) {
    return (
      <div className="dev-cta">
        <span className="dev-cta__waiting" role="status">
          <span className="spinner" aria-hidden="true" /> Aguardando Agente IA
        </span>
      </div>
    );
  }

  // Só oferece iniciar quando a Story está em "A fazer" (Todo).
  if (view.devStatus !== 'todo') return null;

  const onStart = async () => {
    setError(null);
    setStarting(true);
    try {
      applyView(await startDevelopment(repoId, number));
      // Sucesso: a view atualizada (devAgentRequested=true) re-renderiza este
      // componente no estado "Aguardando Agente IA".
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  };

  return (
    <div className="dev-cta">
      <button
        type="button"
        className="btn btn--accent dev-cta__btn"
        onClick={onStart}
        disabled={starting}
        aria-busy={starting}
      >
        {starting ? (
          <>
            <span className="spinner" aria-hidden="true" /> Iniciando…
          </>
        ) : (
          'Iniciar Desenvolvimento'
        )}
      </button>
      <EditError message={error} />
    </div>
  );
}
