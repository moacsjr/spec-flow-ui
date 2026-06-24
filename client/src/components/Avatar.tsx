interface AvatarProps {
  initials: string;
  color: string; // CSS var, ex.: 'var(--av-blue)'
  size: number;
  title?: string;
  textColor?: string; // padrão: tinta escura sobre avatares coloridos
}

export function Avatar({ initials, color, size, title, textColor }: AvatarProps) {
  return (
    <span
      className="avatar"
      title={title}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: color,
        ...(textColor ? { color: textColor } : {}),
      }}
    >
      {initials}
    </span>
  );
}
