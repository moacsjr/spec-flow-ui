import { useEffect, useState } from 'react';
import type { Epic } from './types';
import { loadEpic } from './data/source';
import { TopBar } from './components/TopBar';
import { Hero } from './components/Hero';
import { Description } from './components/Description';
import { FeaturesPanel } from './components/FeaturesPanel';
import { LoadingState } from './components/LoadingState';

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; epic: Epic; source: 'github' | 'fixture' };

export default function App() {
  const [state, setState] = useState<State>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    loadEpic()
      .then((result) => {
        if (active) setState({ phase: 'ready', epic: result.epic, source: result.source });
      })
      .catch((err: unknown) => {
        if (active) setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      active = false;
    };
  }, []);

  if (state.phase === 'loading') {
    return <LoadingState />;
  }

  if (state.phase === 'error') {
    return (
      <div className="state-msg state-msg--error">
        <p>Não foi possível carregar o épico.</p>
        <p>
          <code>{state.message}</code>
        </p>
        <p>
          Configure <code>VITE_GITHUB_TOKEN</code>, <code>VITE_GITHUB_REPO</code> e{' '}
          <code>VITE_GITHUB_EPIC_ISSUE</code>, ou rode sem variáveis para usar o fixture local.
        </p>
      </div>
    );
  }

  const { epic } = state;

  return (
    <>
      <TopBar epic={epic} />
      <main className="page">
        <Hero epic={epic} />
        <div className="body-grid">
          <Description source={epic.descriptionMdx} />
          <FeaturesPanel features={epic.features} />
        </div>
      </main>
    </>
  );
}
