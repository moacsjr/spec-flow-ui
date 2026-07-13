// Badge do tipo de work item (Initiative/Epic/Feature/Story/…). Cor por tipo no
// CSS (`.proj-badge--<slug>`). Compartilhado pelas tabelas do PM.

import type { SnapshotItem } from '@spec-flow/shared';
import { typeOf, typeSlug } from '../../lib/workItemType';

export function TypeBadge({ item }: { item: SnapshotItem }) {
  return <span className={`proj-badge proj-badge--${typeSlug(item)}`}>{typeOf(item)}</span>;
}
