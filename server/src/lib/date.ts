// Formatação de intervalo de datas em pt-BR (ex.: "12 mai – 30 jun"),
// usada pelo adapter no meta "Prazo". Em UTC para ser determinística.

const MONTHS_SHORT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

export function dateRange(startIso?: string | null, endIso?: string | null): string {
  const start = startIso ? fmt(startIso) : '';
  const end = endIso ? fmt(endIso) : '';
  if (start && end) return `${start} – ${end}`;
  return start || end || '—';
}
