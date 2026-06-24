import type { MetaField, WorkItemView } from '@spec-flow/shared';
import { Avatar } from './Avatar';
import { ProgressPanel } from './ProgressPanel';

interface HeroProps {
  view: WorkItemView;
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

export function Hero({ view }: HeroProps) {
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

        <h1 className="hero__title">{view.title}</h1>

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

      <ProgressPanel pct={view.headerPct} items={view.children} label={view.progressLabel} />
    </section>
  );
}
