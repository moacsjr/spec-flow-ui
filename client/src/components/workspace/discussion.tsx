// Discussão integrada ("chat-about-this") — peças compartilhadas pelas telas
// de revisão: hook dos canais ativos (indicador 💬 das filas), botão
// "Discutir no chat"/"Ver discussão" por comentário publicado e o dot da fila.
// O botão só existe quando o repositório tem Slack configurado (capacidade
// lida do snapshot); rascunhos staged nunca o exibem.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchDiscussions,
  openDiscussion,
  type DiscussionInfo,
} from '../../data/workspace';

export function useDiscussions(repoId: string, enabled: boolean, refreshKey: string) {
  const [map, setMap] = useState<Map<number, DiscussionInfo>>(new Map());

  const reload = useCallback(() => {
    if (!enabled) return;
    fetchDiscussions(repoId)
      .then((list) => setMap(new Map(list.map((d) => [d.itemNumber, d]))))
      .catch(() => undefined);
  }, [repoId, enabled]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, refreshKey]);

  return { discussions: map, reloadDiscussions: reload };
}

// Botão por comentário publicado. `discussion` presente = canal ativo existe
// ("Ver discussão"); ausente = primeiro clique cria ("Discutir no chat").
export function DiscussButton({
  repoId,
  featureNumber,
  commentId,
  discussion,
  onOpened,
  onError,
}: {
  repoId: string;
  featureNumber: number;
  commentId: number;
  discussion: DiscussionInfo | undefined;
  onOpened: () => void;
  onError: (message: string, retry: () => void) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    openDiscussion(repoId, featureNumber, commentId)
      .then(({ channelLink }) => {
        window.open(channelLink, '_blank', 'noreferrer');
        onOpened();
      })
      .catch((err: Error) => onError(err.message, run))
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      className="btn btn--sm ds-btn"
      disabled={busy}
      onClick={run}
      title={discussion ? `Canal #${discussion.channelName}` : 'Abrir um canal de discussão para esta feature'}
    >
      {busy ? 'Abrindo…' : discussion ? '💬 Ver discussão' : '💬 Discutir no chat'}
    </button>
  );
}

// Indicador discreto de discussão ativa nas filas. Renderizado como <span>
// clicável porque os itens de fila são <button> (anchor aninhado é inválido).
export function DiscussionDot({ discussion }: { discussion: DiscussionInfo | undefined }) {
  if (!discussion) return null;
  return (
    <span
      className="ds-dot"
      role="link"
      tabIndex={0}
      title={`#${discussion.channelName}`}
      onClick={(e) => {
        e.stopPropagation();
        window.open(discussion.channelLink, '_blank', 'noreferrer');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation();
          window.open(discussion.channelLink, '_blank', 'noreferrer');
        }
      }}
    >
      💬
    </span>
  );
}
