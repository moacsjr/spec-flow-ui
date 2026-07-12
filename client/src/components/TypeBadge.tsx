// Identidade visual do tipo do work item (Jira/Linear-like). Dois formatos:
//   • variant 'icon' → quadradinho colorido com a inicial (breadcrumb, size 'sm').
//   • variant 'pill' → pill tintada com o chip da inicial + o nome do tipo
//     ("[S] Story"), usada no cabeçalho.

import type { WorkItemType } from '@spec-flow/shared';
import { TYPE_BADGE } from '../lib/typeBadge';

interface TypeBadgeProps {
  type: WorkItemType;
  size?: 'sm' | 'md'; // só no variant 'icon'
  variant?: 'icon' | 'pill';
}

export function TypeBadge({ type, size = 'md', variant = 'icon' }: TypeBadgeProps) {
  const info = TYPE_BADGE[type];
  if (!info) return null;

  if (variant === 'pill') {
    return (
      <span className={`type-pill type-pill--${type}`} title={info.label} aria-label={info.label}>
        <span className="type-badge type-badge--sm" aria-hidden="true">
          {info.letter}
        </span>
        <span className="type-pill__label">{info.label}</span>
      </span>
    );
  }

  return (
    <span
      className={`type-badge type-badge--${type} type-badge--${size}`}
      title={info.label}
      aria-label={info.label}
    >
      {info.letter}
    </span>
  );
}
