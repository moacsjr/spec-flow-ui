// Card de um repositório conectado. O card inteiro navega para a HIERARQUIA do
// repositório — a primeira tela é a lista de iniciativas (#/repos/:id/
// initiatives); de lá, iniciativa → épicos → drill existente. A URL do GitHub
// continua abrindo em nova aba (link externo, com stopPropagation para não
// disparar a navegação interna). A URL é sanitizada (só http/https).

import type { KeyboardEvent } from 'react';
import type { Repository } from '@spec-flow/shared';
import { formatDateTime } from '../lib/date';
import { safeHttpUrl } from '../lib/url';
import { hrefForInitiatives, hrefForRepoEdit } from '../lib/router';

interface RepositoryCardProps {
  repo: Repository;
}

export function RepositoryCard({ repo }: RepositoryCardProps) {
  const externalHref = safeHttpUrl(repo.url);
  const goToEpics = () => {
    window.location.hash = hrefForInitiatives(repo.id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToEpics();
    }
  };

  return (
    <div
      className="repo-card repo-card--link"
      role="link"
      tabIndex={0}
      onClick={goToEpics}
      onKeyDown={onKeyDown}
      aria-label={`Ver épicos de ${repo.name}`}
    >
      <div className="repo-card__top">
        <span className="repo-card__dot" />
        <span className="repo-card__name" title={repo.name}>
          {repo.name}
        </span>
        <a
          className="repo-card__edit"
          href={hrefForRepoEdit(repo.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Editar ${repo.name}`}
          title="Editar repositório"
        >
          ✎
        </a>
      </div>

      {externalHref ? (
        <a
          className="repo-card__url"
          href={externalHref}
          target="_blank"
          rel="noopener noreferrer"
          title={externalHref}
          onClick={(e) => e.stopPropagation()}
        >
          {repo.url}
        </a>
      ) : (
        <span className="repo-card__url repo-card__url--invalid">URL inválida</span>
      )}

      <time className="repo-card__date" dateTime={repo.createdAt}>
        {formatDateTime(repo.createdAt)}
      </time>
    </div>
  );
}
