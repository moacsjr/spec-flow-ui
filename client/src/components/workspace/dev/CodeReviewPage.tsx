// Code Review do Developer (RFC-003 §4): variante por milestone da fila de
// code review — PRs vinculados com estado e tempo de espera (QueueList).

import type { WorkspacePageProps } from '../types';
import { QueueList } from '../QueueList';
import { inMilestone, isOpen, isStory, waitingReview } from '../../../lib/workspaceSelectors';

export function DevCodeReviewPage({ repoId, snapshot, milestoneNumber }: WorkspacePageProps) {
  const waiting = inMilestone(
    snapshot.items.filter((i) => isStory(i) && isOpen(i) && waitingReview(i)),
    milestoneNumber,
  );
  return (
    <div className="ws-page">
      <QueueList
        repoId={repoId}
        items={waiting}
        empty="Nenhum PR esperando review."
        showPrs
      />
    </div>
  );
}
