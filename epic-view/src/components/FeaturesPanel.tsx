import type { Feature } from '../types';
import { FeatureCard } from './FeatureCard';

interface FeaturesPanelProps {
  features: Feature[];
}

export function FeaturesPanel({ features }: FeaturesPanelProps) {
  return (
    <section aria-label="Features">
      <div className="features__head">
        <div className="features__head-left">
          <h2 className="h2">Features</h2>
          <span className="count">{features.length}</span>
        </div>
        <button type="button" className="btn btn--accent">
          + Adicionar
        </button>
      </div>

      {features.length === 0 ? (
        <div className="feature-empty">
          Nenhuma feature ainda
          <button type="button" className="btn btn--accent">
            + Adicionar feature
          </button>
        </div>
      ) : (
        <div className="feature-list">
          {features.map((feature, i) => (
            <FeatureCard key={`${feature.name}-${i}`} feature={feature} />
          ))}
        </div>
      )}
    </section>
  );
}
