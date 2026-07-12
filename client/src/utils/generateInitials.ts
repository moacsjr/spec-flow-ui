// Iniciais e cor de fundo do avatar de fallback (Story #66 / Task #68).
//
// generateInitials  → RN003: primeira letra do primeiro nome + primeira do último.
// generateAvatarColor → cor consistente por usuário (mesmo nome ⇒ mesma cor),
//                       escolhida da paleta de avatares em tokens.css.

// Paleta de fallback: os mesmos tokens usados pelos avatares de pessoas na UI.
const AVATAR_COLORS = [
  'var(--av-blue)',
  'var(--av-purple)',
  'var(--av-green)',
  'var(--av-terracota)',
] as const;

/**
 * Gera as iniciais em maiúsculo a partir do nome completo.
 * - 1 nome  → primeira letra apenas.
 * - 2+ nomes → primeira letra do primeiro + primeira do último.
 * - vazio/indefinido → '?' (fallback seguro para nunca renderizar em branco).
 */
export function generateInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return '?';

  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';

  return (first + last).toUpperCase();
}

/**
 * Retorna uma cor de fundo estável para o círculo de fallback, derivada de um
 * hash simples (djb2-like) do nome — determinística e sem dependências.
 */
export function generateAvatarColor(name: string | null | undefined): string {
  const key = (name ?? '').trim();

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    // `| 0` mantém o hash em 32 bits com sinal.
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }

  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}
