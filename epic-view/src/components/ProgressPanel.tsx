import type { Feature } from '../types';
import { STATUS_MAP, epicPct, legendCounts } from '../lib/status';
import { ProgressBar } from './ProgressBar';

interface ProgressPanelProps {
  features: Feature[];
}

export function ProgressPanel({ features }: ProgressPanelProps) {
  const pct = epicPct(features);
  const legend = legendCounts(features);

  const rows = [
    { key: 'done' as const, label: 'Concluídas', count: legend.done },
    { key: 'prog' as const, label: 'Em andamento', count: legend.prog },
    { key: 'todo' as const, label: 'A fazer', count: legend.todo },
  ];

  return (
    <aside className="progress-panel">
      <div className="progress-panel__head">
        <span className="progress-panel__label">Progresso do épico</span>
        <span className="progress-panel__pct">{pct}%</span>
      </div>

      <ProgressBar pct={pct} label={`Progresso do épico: ${pct}%`} />

      <div className="legend">
        {rows.map((row) => (
          <div className="legend__row" key={row.key}>
            <span className="legend__dot" style={{ background: STATUS_MAP[row.key].color }} />
            <span className="legend__label">{row.label}</span>
            <span className="legend__count">{row.count}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
