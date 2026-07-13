// Metadados do planner guardados na descrição do milestone. O GitHub não tem
// campos de "início", "capacidade" nem "release notes" (só title/dueOn/state),
// então embutimos um bloco machine-readable no fim da descrição, invisível na
// maioria dos renders. O payload é JSON codificado em base64 (UTF-8) para
// tolerar texto livre com chaves, aspas ou "-->" (ex.: release notes markdown):
//   <!-- spec-wave-meta:b64 eyJzdGFydCI6Li4ufQ== -->
// A ETA continua sendo o `dueOn` nativo do milestone.

export interface MilestoneMeta {
  start: string | null; // data de início (YYYY-MM-DD)
  capacity: number | null; // capacidade em story points
  releaseNotes: string | null; // release notes geradas (markdown)
}

const META_RE = /<!--\s*spec-wave-meta:b64\s+([A-Za-z0-9+/=]+)\s*-->/;

const b64encode = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const b64decode = (s: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export function parseMilestoneMeta(description: string | null): MilestoneMeta {
  const empty: MilestoneMeta = { start: null, capacity: null, releaseNotes: null };
  if (!description) return empty;
  const match = description.match(META_RE);
  if (!match) return empty;
  try {
    const obj = JSON.parse(b64decode(match[1])) as {
      start?: unknown;
      capacity?: unknown;
      releaseNotes?: unknown;
    };
    return {
      start:
        typeof obj.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.start) ? obj.start : null,
      capacity:
        typeof obj.capacity === 'number' && Number.isFinite(obj.capacity) ? obj.capacity : null,
      releaseNotes: typeof obj.releaseNotes === 'string' ? obj.releaseNotes : null,
    };
  } catch {
    return empty;
  }
}

// Texto visível da descrição (sem o bloco de metadados).
export function visibleDescription(description: string | null): string {
  if (!description) return '';
  return description.replace(META_RE, '').trim();
}

// Reescreve a descrição preservando o texto visível e embutindo os metadados.
export function serializeMilestoneDescription(visible: string, meta: MilestoneMeta): string {
  const text = visible.trim();
  const payload: Record<string, unknown> = {};
  if (meta.start != null) payload.start = meta.start;
  if (meta.capacity != null) payload.capacity = meta.capacity;
  if (meta.releaseNotes != null && meta.releaseNotes.trim()) payload.releaseNotes = meta.releaseNotes;
  if (Object.keys(payload).length === 0) return text;
  const comment = `<!-- spec-wave-meta:b64 ${b64encode(JSON.stringify(payload))} -->`;
  return text ? `${text}\n\n${comment}` : comment;
}
