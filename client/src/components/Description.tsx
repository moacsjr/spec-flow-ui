import { useState } from 'react';
import { Mdx } from './Mdx';

interface DescriptionProps {
  source: string; // Spec (corpo da issue)
  plan?: string | null; // plan.md — quando presente, habilita as abas Spec | Plan
}

type Tab = 'spec' | 'plan';

export function Description({ source, plan }: DescriptionProps) {
  const [tab, setTab] = useState<Tab>('spec');
  const hasPlan = plan != null && plan.trim().length > 0;
  const active = hasPlan ? tab : 'spec';

  return (
    <section className="panel description">
      <div className="description__head">
        {hasPlan ? (
          <div className="description__tabs" role="tablist" aria-label="Descrição">
            <button
              type="button"
              role="tab"
              aria-selected={active === 'spec'}
              className={`description__tab${active === 'spec' ? ' is-active' : ''}`}
              onClick={() => setTab('spec')}
            >
              Spec
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'plan'}
              className={`description__tab${active === 'plan' ? ' is-active' : ''}`}
              onClick={() => setTab('plan')}
            >
              Plan
            </button>
          </div>
        ) : (
          <h2 className="h2">Descrição</h2>
        )}
        <span className="badge-mono">MDX</span>
      </div>
      <Mdx source={active === 'plan' && hasPlan ? plan! : source} />
    </section>
  );
}
