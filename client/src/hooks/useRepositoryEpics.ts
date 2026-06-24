// Hook de dados da tela de épicos de um repositório. Mesmo padrão de
// useRepositories (useEffect + máquina de estados + retry); o efeito refaz a
// busca ao trocar de repositório (keyed em [repoId, nonce]).

import { useCallback, useEffect, useState } from 'react';
import type { RepositoryEpics } from '@spec-flow/shared';
import { fetchRepositoryEpics } from '../data/epics';

export type EpicsState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: RepositoryEpics };

export interface UseRepositoryEpics {
  state: EpicsState;
  retry: () => void;
}

export function useRepositoryEpics(repoId: number): UseRepositoryEpics {
  const [state, setState] = useState<EpicsState>({ phase: 'loading' });
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    fetchRepositoryEpics(repoId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });

    return () => controller.abort();
  }, [repoId, nonce]);

  return { state, retry };
}
