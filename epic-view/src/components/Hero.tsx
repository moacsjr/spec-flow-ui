import type { Epic } from '../types';
import { Avatar } from './Avatar';
import { ProgressPanel } from './ProgressPanel';

interface HeroProps {
  epic: Epic;
}

interface MetaProps {
  label: string;
  children: React.ReactNode;
}

function Meta({ label, children }: MetaProps) {
  return (
    <div className="meta">
      <span className="meta__label">{label}</span>
      <span className="meta__value">{children}</span>
    </div>
  );
}

export function Hero({ epic }: HeroProps) {
  return (
    <section className="hero">
      <div className="hero__identity">
        <div className="hero__toprow">
          {/* Badge de status do épico: sempre estilo "prog" (accent) — RFC seção 5. */}
          <span className="pill">
            <span className="pill__dot" />
            {epic.status}
          </span>
          <span className="code">{epic.code}</span>
        </div>

        <h1 className="hero__title">{epic.title}</h1>

        <div className="meta-row">
          <Meta label="Prioridade">
            <span className="meta__caret" aria-hidden="true">▲</span>
            {epic.priority}
          </Meta>
          <Meta label="Prazo">{epic.dates}</Meta>
          <Meta label="Responsável">
            <Avatar
              initials={epic.owner.initials}
              color={epic.owner.avatarColor}
              size={20}
              title={epic.owner.name}
            />
            {epic.owner.name}
          </Meta>
          <Meta label="Time">{epic.team}</Meta>
        </div>
      </div>

      <ProgressPanel features={epic.features} />
    </section>
  );
}
