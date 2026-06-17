import type { Feature } from '../types';
import { STATUS_MAP } from '../lib/status';
import { Avatar } from './Avatar';
import { ProgressBar } from './ProgressBar';

interface FeatureCardProps {
  feature: Feature;
}

export function FeatureCard({ feature }: FeatureCardProps) {
  const style = STATUS_MAP[feature.status];

  return (
    <article className="feature-card">
      <div className="feature-card__top">
        <span className="feature-card__dot" style={{ background: style.color }} />
        <span className="feature-card__name" title={feature.name}>
          {feature.name}
        </span>
        <Avatar
          initials={feature.assignee.initials}
          color={feature.assignee.avatarColor}
          size={26}
        />
      </div>

      <div className="feature-card__progress">
        {/* A barra usa a cor do status da feature (RFC seção 4.5). */}
        <ProgressBar pct={feature.pct} fill={style.color} label={`${feature.name}: ${feature.pct}%`} />
        <span className="feature-card__pct">{feature.pct}%</span>
      </div>

      <div className="feature-card__footer">
        <div className="tags">
          {feature.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="feature-card__meta">
          <span className="feature-card__tasks">
            {feature.doneTasks}/{feature.totalTasks}
          </span>
          <span
            className="status-badge"
            style={{ color: style.color, background: style.bg }}
          >
            {style.label}
          </span>
        </div>
      </div>
    </article>
  );
}
