// Formatação de data/hora em pt-BR para os cards do Dashboard.

const pad2 = (n: number) => String(n).padStart(2, '0');

// Data + hora no formato pt-BR "dd/MM/yyyy HH:mm" (ex.: "12/05/2024 14:30"),
// no fuso local. Usado nos cards do Dashboard. ISO inválido → "—".
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
