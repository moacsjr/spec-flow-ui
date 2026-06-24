import type { Person } from '@spec-flow/shared';
import { Avatar } from './Avatar';

// Crumb com href já resolvido pela tela (sem href = segmento atual).
export interface BreadCrumb {
  label: string;
  href?: string;
}

interface TopBarProps {
  breadcrumb: BreadCrumb[];
  owner: Person;
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
    </svg>
  );
}

export function TopBar({ breadcrumb, owner }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__left">
        <span className="brand" aria-hidden="true" />
        <nav className="breadcrumb" aria-label="Navegação">
          {breadcrumb.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} style={{ display: 'contents' }}>
              {i > 0 && <span className="breadcrumb__sep">/</span>}
              {crumb.href ? (
                <a className="breadcrumb__seg" href={crumb.href}>
                  {crumb.label}
                </a>
              ) : (
                <span
                  className={`breadcrumb__seg${i === breadcrumb.length - 1 ? ' breadcrumb__seg--current' : ''}`}
                >
                  {crumb.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="topbar__right">
        <button type="button" className="btn">
          <EditIcon /> Editar
        </button>
        <button type="button" className="btn">
          <CommentIcon /> Comentar
        </button>
        <Avatar
          initials={owner.initials}
          color="#3a322b"
          textColor="var(--text-2)"
          size={30}
          title={owner.name}
        />
      </div>
    </header>
  );
}
