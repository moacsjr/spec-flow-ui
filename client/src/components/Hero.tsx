import type { MetaField, WorkItemPatch, WorkItemView } from '@spec-flow/shared';
import { Avatar } from './Avatar';
import { ProgressPanel } from './ProgressPanel';
import { StoryDevAction } from './StoryDevAction';
import { EditButton, EditError, EditActions } from './EditControls';
import { useInlineEdit } from '../hooks/useInlineEdit';

interface HeroProps {
  view: WorkItemView;
  repoId: string;
  number: number;
  applyView: (view: WorkItemView) => void;
  onSave?: (patch: WorkItemPatch) => Promise<void>;
}

function MetaValue({ field }: { field: MetaField }) {
  if (field.kind === 'priority') {
    return (
      <>
        <span className="meta__caret" aria-hidden="true">
          ▲
        </span>
        {field.value}
      </>
    );
  }
  if (field.kind === 'person' && field.person) {
    return (
      <>
        <Avatar
          initials={field.person.initials}
          color={field.person.avatarColor}
          size={20}
          title={field.person.name}
        />
        {field.person.name}
      </>
    );
  }
  return <>{field.value}</>;
}

export function Hero({ view, repoId, number, applyView, onSave }: HeroProps) {
  const title = useInlineEdit(view.title, (draft) => ({ title: draft.trim() }), onSave);
  const titleValid = title.draft.trim().length > 0;

  // Story View: CTA "Iniciar Desenvolvimento" dentro do card de progresso.
  const devCta =
    view.level === 'story' ? (
      <StoryDevAction repoId={repoId} number={number} view={view} applyView={applyView} />
    ) : undefined;

  return (
    <section className="hero">
      <div className="hero__identity">
        <div className="hero__toprow">
          {/* Badge de status: sempre estilo "prog" (accent) — RFC seção 5. */}
          <span className="pill">
            <span className="pill__dot" />
            {view.status}
          </span>
          <span className="code">{view.code}</span>
        </div>

        {view.planApproved && (
          <span className="badge badge--approved">Aprovado</span>
        )}

        {title.editing ? (
          <div className="hero__title-edit">
            <input
              className="edit-input edit-input--title"
              value={title.draft}
              onChange={(e) => title.setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && titleValid) title.save();
                if (e.key === 'Escape') title.cancel();
              }}
              aria-label="Título"
              autoFocus
            />
            <EditActions edit={title} canSave={titleValid} />
            <EditError message={title.error} />
          </div>
        ) : (
          <div className="hero__title-row">
            <h1 className="hero__title">{view.title}</h1>
            {onSave && <EditButton label="Editar título" onClick={title.begin} />}
          </div>
        )}

        <div className="meta-row">
          {view.meta.map((field) => (
            <div className="meta" key={field.label}>
              <span className="meta__label">{field.label}</span>
              <span className="meta__value">
                <MetaValue field={field} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <ProgressPanel
        pct={view.headerPct}
        items={view.children}
        label={view.progressLabel}
        cta={devCta}
      />
    </section>
  );
}
