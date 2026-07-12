import { useEffect, useState } from 'react';
import { generateAvatarColor, generateInitials } from '../utils/generateInitials';

// Avatar do usuário no cabeçalho (Story #66 / Task #67).
//
// Ordem de exibição:
//   1. Se há `avatarUrl`, tenta carregar a imagem (RN002).
//   2. Enquanto carrega, mostra um placeholder sutil (shimmer).
//   3. Em erro de carregamento (imagem corrompida/URL inválida) ou ausência de
//      URL, cai para as iniciais em um círculo colorido (RN003 / CE001).

export interface AvatarUser {
  name: string;
  avatarUrl?: string | null;
}

interface UserAvatarProps {
  user: AvatarUser;
  /** Diâmetro do círculo em px. Padrão: 30. */
  size?: number;
  /** Sobrescreve o `title`/`alt`; por padrão usa o nome do usuário. */
  title?: string;
}

type ImageState = 'loading' | 'loaded' | 'error';

export function UserAvatar({ user, size = 30, title }: UserAvatarProps) {
  const hasUrl = Boolean(user.avatarUrl);
  const [state, setState] = useState<ImageState>(hasUrl ? 'loading' : 'error');

  // Reinicia o ciclo de carga ao trocar a URL (novo usuário / avatar atualizado).
  useEffect(() => {
    setState(user.avatarUrl ? 'loading' : 'error');
  }, [user.avatarUrl]);

  const label = title ?? user.name;
  const showImage = hasUrl && state !== 'error';

  return (
    <span
      className="avatar avatar--profile"
      title={label}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        // A cor de fundo só aparece no fallback de iniciais.
        background: showImage ? undefined : generateAvatarColor(user.name),
      }}
    >
      {showImage ? (
        <img
          className="avatar__img"
          src={user.avatarUrl ?? undefined}
          alt={label}
          width={size}
          height={size}
          style={{ opacity: state === 'loaded' ? 1 : 0 }}
          onLoad={() => setState('loaded')}
          onError={() => {
            // CE001: registra a falha para debugging antes de cair no fallback.
            console.error(`UserAvatar: falha ao carregar avatar de "${user.name}"`);
            setState('error');
          }}
        />
      ) : (
        <span aria-hidden="true">{generateInitials(user.name)}</span>
      )}

      {showImage && state === 'loading' && (
        <span className="avatar__placeholder" aria-hidden="true" />
      )}
    </span>
  );
}
