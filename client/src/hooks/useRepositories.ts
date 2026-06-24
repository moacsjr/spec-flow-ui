// Hook de dados do Dashboard. Segue o padrão do epic-view (useEffect +
// máquina de estados, sem React Query) para manter a consistência da base:
// expõe loading / error / ready e um `retry` para o estado de erro.

import { useCallback, useEffect, useState } from 'react';
import type { Repository } from '@spec-flow/shared';
import { fetchRepositories } from '../data/repositories';

export type RepositoriesState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; repositories: Repository[] };

export interface UseRepositories {
  state: RepositoriesState;
  retry: () => void;
}

export function useRepositories(): UseRepositories {
  const [state, setState] = useState<RepositoriesState>({ phase: 'loading' });
  // Incrementar `nonce` re-dispara o efeito de carga (botão "Tentar novamente").
  const [nonce, setNonce] = useState(0);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // O guard via AbortController cobre o duplo-efeito do StrictMode e evita
  // aplicar estado obsoleto se o componente desmontar durante o fetch.
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });

    fetchRepositories(controller.signal)
      .then((repositories) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', repositories });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });

    return () => controller.abort();
  }, [nonce]);

  return { state, retry };
}
