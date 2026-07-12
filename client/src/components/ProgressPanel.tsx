import type { ReactNode } from 'react';
import type { ChildItem } from '@spec-flow/shared';
import { STATUS_MAP, legendCounts } from '../lib/status';
import { ProgressBar } from './ProgressBar';

interface ProgressPanelProps {
  pct: number; // % grande (cabeçalho); calculado pelo adapter conforme o nível
  items: ChildItem[]; // filhos, para a legenda
  label: string; // "Progresso do épico" / "da feature" / "da story"
  cta?: ReactNode; // CTA principal opcional (Story View: "Iniciar Desenvolvimento")
}

export function ProgressPanel({ pct, items, label, cta }: ProgressPanelProps) {
  const legend = legendCounts(items);

  const rows = [
    { key: 'done' as const, label: 'Concluídas', count: legend.done },
    { key: 'prog' as const, label: 'Em andamento', count: legend.prog },
    { key: 'todo' as const, label: 'A fazer', count: legend.todo },
  ];

  return (
    <aside className="progress-panel">
      <div className="progress-panel__head">
        <span className="progress-panel__label">{label}</span>
        <span className="progress-panel__pct">{pct}%</span>
      </div>

      <ProgressBar pct={pct} label={`${label}: ${pct}%`} />

      <div className="legend">
        {rows.map((row) => (
          <div className="legend__row" key={row.key}>
            <span className="legend__dot" style={{ background: STATUS_MAP[row.key].color }} />
            <span className="legend__label">{row.label}</span>
            <span className="legend__count">{row.count}</span>
          </div>
        ))}
      </div>

      {cta && <div className="progress-panel__cta">{cta}</div>}
    </aside>
  );
}
