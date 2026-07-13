// Planning do PM (RFC-003 §2): Stories agrupadas pela sua Feature-pai, com filtro
// por Iniciativa (a Initiative ancestral da Story). Atribuir um milestone a uma
// Story atualiza o campo Milestone da issue no GitHub — fonte de verdade; o
// milestone aparece como chip na linha. O "Create milestone" segue no topo para
// alimentar o select de atribuição.

import { useMemo, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { QueueList } from '../QueueList';
import { TypeBadge } from '../TypeBadge';
import { isOpen, isStory } from '../../../lib/workspaceSelectors';
import { ancestorOfType, itemsByNumber, parentOf, typeSlug } from '../../../lib/workItemType';
import { createMilestone, setStoryMilestone } from '../../../data/workspace';

interface FeatureGroup {
  key: string;
  feature: SnapshotItem | null; // null = stories sem Feature-pai
  items: SnapshotItem[];
}

function NewMilestoneForm({ repoId, onDone }: { repoId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = () => {
    if (!title.trim()) return;
    setSaving(true);
    createMilestone(repoId, { title: title.trim(), dueOn: dueOn || undefined })
      .then(onDone)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="idea-form idea-form--inline">
      <input
        type="text"
        placeholder="Nome do milestone…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        type="date"
        value={dueOn}
        onChange={(e) => setDueOn(e.target.value)}
        aria-label="Data-alvo"
      />
      <button
        type="button"
        className="btn btn--sm btn--accent"
        onClick={submit}
        disabled={saving || !title.trim()}
      >
        {saving ? 'Criando…' : 'Create milestone'}
      </button>
    </div>
  );
}

export function PlanningPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [busy, setBusy] = useState(false);
  const [initiativeFilter, setInitiativeFilter] = useState('');

  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);

  const stories = useMemo(
    () => snapshot.items.filter((i) => isStory(i) && isOpen(i)),
    [snapshot.items],
  );

  // Iniciativas abertas para o filtro (raiz da hierarquia da Story).
  const initiatives = useMemo(
    () =>
      snapshot.items
        .filter((i) => typeSlug(i) === 'initiative' && isOpen(i))
        .sort((a, b) => a.number - b.number),
    [snapshot.items],
  );

  const filteredStories = useMemo(() => {
    if (!initiativeFilter) return stories;
    const target = Number(initiativeFilter);
    return stories.filter(
      (s) => ancestorOfType(s, byNumber, 'initiative')?.number === target,
    );
  }, [stories, initiativeFilter, byNumber]);

  // Agrupa por Feature-pai (parentNumber). Features por número; "Sem feature" ao fim.
  const groups = useMemo<FeatureGroup[]>(() => {
    const map = new Map<number, FeatureGroup>();
    const none: FeatureGroup = { key: 'none', feature: null, items: [] };
    for (const story of filteredStories) {
      const feature = parentOf(story, byNumber);
      if (!feature) {
        none.items.push(story);
        continue;
      }
      const key = `f${feature.number}`;
      let group = map.get(feature.number);
      if (!group) {
        group = { key, feature, items: [] };
        map.set(feature.number, group);
      }
      group.items.push(story);
    }
    const result = [...map.values()].sort(
      (a, b) => (a.feature?.number ?? 0) - (b.feature?.number ?? 0),
    );
    if (none.items.length > 0) result.push(none);
    return result;
  }, [filteredStories, byNumber]);

  const openMilestones = snapshot.milestones.filter((m) => m.state === 'open');

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .then(() => refresh())
      .catch((err: Error) => alert(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className="ws-page">
      <div className="ws-toolbar">
        <label className="ws-toolbar__label">
          Iniciativa{' '}
          <select
            value={initiativeFilter}
            onChange={(e) => setInitiativeFilter(e.target.value)}
            aria-label="Filtrar por iniciativa"
          >
            <option value="">Todas</option>
            {initiatives.map((i) => (
              <option key={i.number} value={i.number}>
                #{i.number} {i.title}
              </option>
            ))}
          </select>
        </label>
        <span className="ws-toolbar__spacer" />
        <NewMilestoneForm repoId={repoId} onDone={refresh} />
      </div>

      {groups.length === 0 && (
        <p className="queue__empty">
          {initiativeFilter
            ? 'Nenhuma story nesta iniciativa.'
            : 'Nenhuma story aberta para planejar.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="ws-section">
          <header className="ws-section__head">
            <h3 className="ws-section__title">
              {group.feature ? (
                <>
                  <TypeBadge item={group.feature} />
                  <span className="ws-section__featurenum">#{group.feature.number}</span>{' '}
                  {group.feature.title}
                </>
              ) : (
                'Sem feature'
              )}
              <span className="ws-section__count">{group.items.length}</span>
            </h3>
          </header>

          <QueueList
            repoId={repoId}
            items={group.items}
            empty=""
            meta={(item) =>
              !item.milestone ? (
                <select
                  className="queue__priosel"
                  value=""
                  disabled={busy || openMilestones.length === 0}
                  onChange={(e) => {
                    if (e.target.value) {
                      run(() => setStoryMilestone(repoId, item.number, Number(e.target.value)));
                    }
                  }}
                  aria-label={`Milestone de #${item.number}`}
                >
                  <option value="">Assign to…</option>
                  {openMilestones.map((m) => (
                    <option key={m.number} value={m.number}>
                      {m.title}
                    </option>
                  ))}
                </select>
              ) : null
            }
            actions={(item) =>
              item.milestone
                ? [
                    {
                      label: 'Remove milestone',
                      disabled: busy,
                      onClick: () => run(() => setStoryMilestone(repoId, item.number, null)),
                    },
                  ]
                : []
            }
          />
        </section>
      ))}
    </div>
  );
}
