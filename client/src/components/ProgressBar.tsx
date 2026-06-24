interface ProgressBarProps {
  pct: number;
  // Cor do preenchimento. Quando omitida, usa o gradiente accent (barra do épico).
  fill?: string;
  label?: string;
}

export function ProgressBar({ pct, fill, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="track"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="track__fill" style={{ width: `${clamped}%`, background: fill }} />
    </div>
  );
}
