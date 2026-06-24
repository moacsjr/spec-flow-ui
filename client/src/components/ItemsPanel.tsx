import type { ChildItem } from '@spec-flow/shared';
import { ItemCard } from './ItemCard';

interface ItemsPanelProps {
  items: ChildItem[];
  label: string; // "Features" | "Stories" | "Tasks"
  repoId: number; // escopa os links de drill-down dos cards
}

export function ItemsPanel({ items, label, repoId }: ItemsPanelProps) {
  return (
    <section aria-label={label}>
      <div className="features__head">
        <div className="features__head-left">
          <h2 className="h2">{label}</h2>
          <span className="count">{items.length}</span>
        </div>
        <button type="button" className="btn btn--accent">
          + Adicionar
        </button>
      </div>

      {items.length === 0 ? (
        <div className="feature-empty">
          {`Nenhuma ${label.toLowerCase()} ainda`}
          <button type="button" className="btn btn--accent">
            + Adicionar
          </button>
        </div>
      ) : (
        <div className="feature-list">
          {items.map((item, i) => (
            <ItemCard key={`${item.name}-${i}`} item={item} repoId={repoId} />
          ))}
        </div>
      )}
    </section>
  );
}
