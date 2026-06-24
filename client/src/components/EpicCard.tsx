// Card de um épico na lista de épicos de um repositório. Reusa o visual de
// feature-card; clicar abre o work item do épico (#/repos/:id/epic/:number).

import type { EpicSummary } from '@spec-flow/shared';
import { STATUS_MAP } from '../lib/status';
import { hrefForItem } from '../lib/router';

interface EpicCardProps {
  repoId: number;
  epic: EpicSummary;
}

export function EpicCard({ repoId, epic }: EpicCardProps) {
  // open → em andamento (accent); closed → concluída (verde).
  const style = epic.state === 'closed' ? STATUS_MAP.done : STATUS_MAP.prog;
  const stateLabel = epic.state === 'closed' ? 'Fechado' : 'Aberto';

  return (
    <a className="feature-card feature-card-link" href={hrefForItem(repoId, 'epic', epic.number)}>
      <div className="feature-card__top">
        <span className="feature-card__dot" style={{ background: style.color }} />
        <span className="feature-card__name" title={epic.title}>
          {epic.title}
        </span>
      </div>
      <div className="feature-card__footer">
        <div className="tags">
          <span className="tag">{epic.code}</span>
        </div>
        <div className="feature-card__meta">
          <span className="status-badge" style={{ color: style.color, background: style.bg }}>
            {stateLabel}
          </span>
        </div>
      </div>
    </a>
  );
}
