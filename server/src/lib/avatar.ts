// Helpers de avatar: iniciais e cor estável a partir de um identificador.

const AVATAR_COLORS = [
  'var(--av-blue)',
  'var(--av-purple)',
  'var(--av-green)',
  'var(--av-terracota)',
];

// Hash determinístico → mesma pessoa sempre recebe a mesma cor.
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// "Vinícius Cardoso" → "VC"; "vcardoso" → "VC"; cai para 2 primeiras letras.
export function initials(nameOrLogin: string): string {
  const cleaned = nameOrLogin.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}
