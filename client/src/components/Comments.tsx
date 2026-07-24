// Comentários da issue (Epic / Feature / Story View). Os dados chegam embutidos
// no WorkItemView — nenhum request adicional é feito aqui. Ordem cronológica
// (mais antigo primeiro), corpo renderizado com o mesmo pipeline MDX da descrição.

import type { IssueComment } from '@spec-flow/shared';
import { Avatar } from './Avatar';
import { Mdx } from './Mdx';
import { formatDateTime } from '../lib/date';

interface CommentsProps {
  comments: IssueComment[];
}

export function Comments({ comments }: CommentsProps) {
  return (
    <section className="panel comments" aria-label="Comentários">
      <div className="comments__head">
        <h2 className="h2">Comentários</h2>
        <span className="count">{comments.length}</span>
      </div>

      {comments.length === 0 ? (
        <p className="comments__empty">Nenhum comentário nesta issue.</p>
      ) : (
        <ol className="comments__list">
          {comments.map((c, i) => (
            <li key={`${c.createdAt}-${i}`} className="comment">
              <div className="comment__meta">
                <Avatar
                  initials={c.author.initials}
                  color={c.author.avatarColor}
                  size={26}
                  title={c.author.name}
                />
                <span className="comment__author">{c.author.name}</span>
                <span className="comment__date">{formatDateTime(c.createdAt)}</span>
              </div>
              <Mdx source={c.bodyMdx} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
