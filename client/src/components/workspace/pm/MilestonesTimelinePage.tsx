// Milestones Timeline (Gestão de Milestones) — Gantt simplificado do PM.
// KPIs + filtros de status + timeline com linha "Hoje" e barras coloridas por
// status; clicar abre o drawer; drag/resize das barras atualizam início/ETA
// (otimista + persistência). Dados reais de issues/milestones do snapshot.
//
// Como o GitHub milestone só persiste title/dueOn/state, o INÍCIO e a CAPACIDADE
// ficam em metadados na descrição (ver lib/milestoneMeta). A ETA é o dueOn.

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MilestoneSummary, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { isStory } from '../../../lib/workspaceSelectors';
import { hrefForItem, hrefForWorkspace } from '../../../lib/router';
import {
  parseMilestoneMeta,
  serializeMilestoneDescription,
  visibleDescription,
} from '../../../lib/milestoneMeta';
import {
  createMilestone,
  deleteMilestone,
  generateReleaseNotes,
  updateMilestone,
} from '../../../data/workspace';
import { Mdx } from '../../Mdx';

const DAY = 86_400_000;
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DEFAULT_DURATION_DAYS = 21; // início padrão quando o milestone ainda não tem metadado

type StatusKey = 'concluida' | 'andamento' | 'atrasada' | 'planejada';

const STATUS: Record<StatusKey, { label: string; varName: string }> = {
  concluida: { label: 'Concluída', varName: '--done' },
  planejada: { label: 'Planejada', varName: '--av-blue' },
  andamento: { label: 'Em andamento', varName: '--warning' },
  atrasada: { label: 'Atrasada', varName: '--danger' },
};
const FILTERS: { key: 'todos' | StatusKey; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'planejada', label: 'Planejadas' },
  { key: 'andamento', label: 'Em andamento' },
  { key: 'concluida', label: 'Concluídas' },
];
type Scale = 'meses' | 'semanas' | 'trimestres';

// ---- helpers de data (UTC, sem hora) ----
const parseDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const fmtShort = (d: Date | null) => (d ? `${d.getUTCDate()} ${MONTHS_PT[d.getUTCMonth()]}` : '—');
const fmtFull = (d: Date | null) =>
  d
    ? `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    : '—';
const toISODate = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const toISODateTime = (d: Date) => `${toISODate(d)}T00:00:00Z`;

interface Row {
  number: number;
  title: string;
  status: StatusKey;
  state: 'open' | 'closed';
  start: Date | null;
  eta: Date | null;
  storyCount: number;
  plannedPoints: number;
  completedPoints: number;
  capacity: number | null;
  description: string; // texto visível (sem metadados)
  releaseNotes: string | null; // release notes salvas (markdown)
  owner: string | null;
}

function statusOf(m: MilestoneSummary, eta: Date | null, today: Date): StatusKey {
  if (m.state === 'closed') return 'concluida';
  if (eta && eta.getTime() < today.getTime()) return 'atrasada';
  return m.closedCount > 0 ? 'andamento' : 'planejada';
}

// Owner heurístico: assignee mais frequente entre as stories do milestone.
function ownerOf(stories: SnapshotItem[]): string | null {
  const counts = new Map<string, number>();
  for (const s of stories) {
    const login = s.assignees[0]?.name ?? s.assignees[0]?.login;
    if (login) counts.set(login, (counts.get(login) ?? 0) + 1);
  }
  let best: string | null = null;
  let max = 0;
  for (const [name, n] of counts) if (n > max) ((max = n), (best = name));
  return best;
}

interface DragState {
  number: number;
  mode: 'move' | 'l' | 'r';
  startX: number;
  pxPerDay: number;
  origStart: number;
  origEta: number;
  curStart: number;
  curEta: number;
}

export function MilestonesTimelinePage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const today = useMemo(() => utcMidnight(new Date(snapshot.generatedAt)), [snapshot.generatedAt]);

  // Deriva as linhas do snapshot; guarda em estado para a atualização otimista.
  const derive = (): Row[] => {
    const stories = snapshot.items.filter(isStory);
    return snapshot.milestones
      .map((m) => {
        const meta = parseMilestoneMeta(m.description);
        const eta = parseDate(m.dueOn);
        const start = meta.start
          ? parseDate(`${meta.start}T00:00:00Z`)
          : eta
            ? addDays(eta, -DEFAULT_DURATION_DAYS)
            : null;
        const assigned = stories.filter((s) => s.milestone?.number === m.number);
        const plannedPoints = assigned.reduce((sum, s) => sum + (s.points ?? 0), 0);
        const completedPoints = assigned
          .filter((s) => s.state === 'closed' || s.stage === 'Done')
          .reduce((sum, s) => sum + (s.points ?? 0), 0);
        return {
          number: m.number,
          title: m.title,
          status: statusOf(m, eta, today),
          state: m.state,
          start,
          eta,
          storyCount: assigned.length,
          plannedPoints,
          completedPoints,
          capacity: meta.capacity,
          description: visibleDescription(m.description),
          releaseNotes: meta.releaseNotes,
          owner: ownerOf(assigned),
        };
      })
      .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  };

  const [rows, setRows] = useState<Row[]>(derive);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setRows(derive()), [snapshot]);

  const [filter, setFilter] = useState<'todos' | StatusKey>('todos');
  const [scale, setScale] = useState<Scale>('meses');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; row: Row } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [busy, setBusy] = useState(false);

  // Faixa temporal visível (snap para o mês) a partir das barras posicionáveis.
  const { rangeStart, rangeEnd } = useMemo(() => {
    const dated = rows.filter((r) => r.start && r.eta);
    if (dated.length === 0) {
      const s = startOfMonth(addDays(today, -15));
      return { rangeStart: s, rangeEnd: nextMonth(addDays(today, 75)) };
    }
    const minStart = Math.min(...dated.map((r) => r.start!.getTime()));
    const maxEta = Math.max(...dated.map((r) => r.eta!.getTime()));
    return { rangeStart: startOfMonth(new Date(minStart)), rangeEnd: nextMonth(new Date(maxEta)) };
  }, [rows, today]);

  const totalMs = Math.max(rangeEnd.getTime() - rangeStart.getTime(), DAY);
  const pct = (d: Date) => ((d.getTime() - rangeStart.getTime()) / totalMs) * 100;

  // Colunas do cabeçalho conforme a escala.
  const columns = useMemo(() => {
    const cols: { label: string; left: number }[] = [];
    if (scale === 'semanas') {
      for (let t = rangeStart.getTime(); t < rangeEnd.getTime(); t += 7 * DAY) {
        const d = new Date(t);
        cols.push({ label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, left: pct(d) });
      }
    } else {
      const step = scale === 'trimestres' ? 3 : 1;
      let d = new Date(rangeStart);
      while (d.getTime() < rangeEnd.getTime()) {
        const label =
          scale === 'trimestres'
            ? `${MONTHS_PT[d.getUTCMonth()]}–${MONTHS_PT[Math.min(d.getUTCMonth() + 2, 11)]}`
            : MONTHS_PT[d.getUTCMonth()];
        cols.push({ label, left: pct(d) });
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1));
      }
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, rangeStart, rangeEnd, totalMs]);

  const todayPct = pct(today);
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  const visibleRows = rows.filter((r) => filter === 'todos' || r.status === filter);
  const counts = (s: StatusKey) => rows.filter((r) => r.status === s).length;
  const nextEta = rows
    .filter((r) => r.state === 'open' && r.eta && r.eta.getTime() >= today.getTime())
    .sort((a, b) => a.eta!.getTime() - b.eta!.getTime())[0]?.eta;

  const selected = selectedId != null ? rows.find((r) => r.number === selectedId) ?? null : null;

  // ---- persistência (otimista) de datas após drag/resize ----
  const commitDates = (row: Row, start: Date, eta: Date) => {
    setRows((rs) => rs.map((r) => (r.number === row.number ? { ...r, start, eta } : r)));
    setBusy(true);
    const description = serializeMilestoneDescription(row.description, {
      start: toISODate(start),
      capacity: row.capacity,
      releaseNotes: row.releaseNotes,
    });
    updateMilestone(repoId, row.number, { dueOn: toISODateTime(eta), description })
      .then(() => refresh())
      .catch((err: Error) => {
        alert(err.message);
        refresh();
      })
      .finally(() => setBusy(false));
  };

  // ---- drag / resize ----
  const onBarPointerDown = (
    e: ReactPointerEvent,
    row: Row,
    mode: DragState['mode'],
  ) => {
    if (busy || !row.start || !row.eta) return;
    e.preventDefault();
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest('.mst-track');
    if (!track) return;
    const width = track.getBoundingClientRect().width;
    const totalDays = totalMs / DAY;
    setDrag({
      number: row.number,
      mode,
      startX: e.clientX,
      pxPerDay: width / totalDays,
      origStart: row.start.getTime(),
      origEta: row.eta.getTime(),
      curStart: row.start.getTime(),
      curEta: row.eta.getTime(),
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const deltaDays = Math.round((e.clientX - drag.startX) / drag.pxPerDay);
      const shift = deltaDays * DAY;
      let curStart = drag.origStart;
      let curEta = drag.origEta;
      if (drag.mode === 'move') {
        curStart = drag.origStart + shift;
        curEta = drag.origEta + shift;
      } else if (drag.mode === 'l') {
        curStart = Math.min(drag.origStart + shift, drag.origEta - DAY);
      } else {
        curEta = Math.max(drag.origEta + shift, drag.origStart + DAY);
      }
      setDrag((d) => (d ? { ...d, curStart, curEta } : d));
    };
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          const row = rows.find((r) => r.number === d.number);
          if (row) commitDates(row, new Date(d.curStart), new Date(d.curEta));
        }
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const removeMilestone = (row: Row) => {
    if (!confirm(`Excluir o milestone "${row.title}"? As stories ficam sem milestone.`)) return;
    setBusy(true);
    setSelectedId(null);
    deleteMilestone(repoId, row.number)
      .then(() => refresh())
      .catch((err: Error) => alert(err.message))
      .finally(() => setBusy(false));
  };

  const kpis = [
    { label: 'Milestones', value: String(rows.length), varName: null as string | null },
    { label: 'Planejadas', value: String(counts('planejada')), varName: '--av-blue' },
    { label: 'Em andamento', value: String(counts('andamento')), varName: '--warning' },
    { label: 'Concluídas', value: String(counts('concluida')), varName: '--done' },
    { label: 'Próxima ETA', value: fmtShort(nextEta ?? null), varName: null, accent: true },
  ];

  return (
    <div className={`mst${selected ? ' mst--drawer' : ''}`}>
      <div className="mst-main">
        {/* KPIs */}
        <div className="mst-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="mst-kpi">
              <span className="mst-kpi__label">{k.label}</span>
              <span className={`mst-kpi__value${k.accent ? ' mst-kpi__value--accent' : ''}`}>
                {k.varName && (
                  <span className="mst-dot" style={{ background: `var(${k.varName})` }} />
                )}
                {k.value}
              </span>
            </div>
          ))}
        </div>

        {/* Filtros + escala + Nova */}
        <div className="mst-controls">
          <div className="mst-seg" role="tablist" aria-label="Filtrar por status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={`mst-seg__btn${filter === f.key ? ' mst-seg__btn--on' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="mst-controls__spacer" />
          <span className="mst-controls__label">Escala</span>
          <div className="mst-seg" role="tablist" aria-label="Escala">
            {(['meses', 'semanas', 'trimestres'] as Scale[]).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scale === s}
                className={`mst-seg__btn${scale === s ? ' mst-seg__btn--on' : ''}`}
                onClick={() => setScale(s)}
              >
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--sm btn--accent" onClick={() => setModal({ mode: 'new' })}>
            + Nova Milestone
          </button>
        </div>

        {/* Timeline */}
        <div className="mst-timeline">
          <div className="mst-tl-head">
            <div className="mst-tl-label">Milestone</div>
            <div className="mst-track mst-track--head">
              {columns.map((c, i) => (
                <span key={i} className="mst-col" style={{ left: `${c.left}%` }}>
                  {c.label}
                </span>
              ))}
              {todayVisible && (
                <span className="mst-today-tag" style={{ left: `${todayPct}%` }}>
                  Hoje
                </span>
              )}
            </div>
          </div>

          <div className="mst-rows">
            {/* grid de fundo (divisórias) + linha Hoje atravessando as linhas */}
            {visibleRows.length === 0 && <p className="queue__empty">Nenhum milestone neste filtro.</p>}
            {visibleRows.map((row) => {
              const st = STATUS[row.status];
              const dragging = drag?.number === row.number;
              const start = dragging ? new Date(drag!.curStart) : row.start;
              const eta = dragging ? new Date(drag!.curEta) : row.eta;
              const placeable = !!start && !!eta;
              const left = placeable ? pct(start!) : 0;
              const width = placeable ? Math.max(pct(eta!) - pct(start!), 1.5) : 0;
              return (
                <div key={row.number} className="mst-row">
                  <button
                    type="button"
                    className={`mst-tl-label mst-rowlabel${selectedId === row.number ? ' mst-rowlabel--on' : ''}`}
                    onClick={() => setSelectedId(row.number)}
                  >
                    <span className="mst-rowlabel__name">{row.title}</span>
                    <span className="mst-rowlabel__status">
                      <span className="mst-dot" style={{ background: `var(${st.varName})` }} />
                      {st.label}
                    </span>
                  </button>
                  <div className="mst-track">
                    {columns.map((c, i) => (
                      <span key={i} className="mst-gridline" style={{ left: `${c.left}%` }} />
                    ))}
                    {todayVisible && <span className="mst-today" style={{ left: `${todayPct}%` }} />}
                    {placeable ? (
                      <div
                        className={`mst-bar${selectedId === row.number ? ' mst-bar--on' : ''}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          ['--bar' as string]: `var(${st.varName})`,
                        }}
                        onClick={() => setSelectedId(row.number)}
                        onPointerDown={(e) => onBarPointerDown(e, row, 'move')}
                        title={`${row.title} · ${fmtFull(start)} → ${fmtFull(eta)}`}
                      >
                        <span
                          className="mst-bar__handle mst-bar__handle--l"
                          onPointerDown={(e) => onBarPointerDown(e, row, 'l')}
                        />
                        <span className="mst-bar__body">
                          <span className="mst-bar__eta">ETA {fmtShort(eta)}</span>
                          <span className="mst-bar__stories">{row.storyCount} stories</span>
                        </span>
                        <span
                          className="mst-bar__handle mst-bar__handle--r"
                          onPointerDown={(e) => onBarPointerDown(e, row, 'r')}
                        />
                      </div>
                    ) : (
                      <span className="mst-bar-missing">Defina uma ETA</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mst-legend">
            {(Object.keys(STATUS) as StatusKey[]).map((k) => (
              <span key={k} className="mst-legend__item">
                <span className="mst-dot" style={{ background: `var(${STATUS[k].varName})` }} />
                {STATUS[k].label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Drawer */}
      {selected && (
        <MilestoneDrawer
          row={selected}
          repoId={repoId}
          stories={snapshot.items.filter(
            (i) => isStory(i) && i.milestone?.number === selected.number,
          )}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onEdit={() => setModal({ mode: 'edit', row: selected })}
          onDelete={() => removeMilestone(selected)}
          onRefresh={refresh}
        />
      )}

      {/* Modal criar/editar */}
      {modal && (
        <MilestoneModal
          repoId={repoId}
          initial={modal.mode === 'edit' ? modal.row : null}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------- Drawer ----------------

function MilestoneDrawer({
  row,
  repoId,
  stories,
  busy,
  onClose,
  onEdit,
  onDelete,
  onRefresh,
}: {
  row: Row;
  repoId: string;
  stories: SnapshotItem[];
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<'details' | 'notes'>('details');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = STATUS[row.status];
  const cap = row.capacity;
  const capPct = cap && cap > 0 ? Math.min(Math.round((row.plannedPoints / cap) * 100), 100) : null;
  const capOver = cap != null && cap > 0 && row.plannedPoints / cap > 0.9;

  // Gera as Release Notes via LLM e persiste no metadado da descrição.
  const generate = () => {
    setGenerating(true);
    setGenError(null);
    generateReleaseNotes(repoId, row.number)
      .then((text) => {
        const description = serializeMilestoneDescription(row.description, {
          start: row.start ? toISODate(row.start) : null,
          capacity: row.capacity,
          releaseNotes: text,
        });
        return updateMilestone(repoId, row.number, { description }).then(() => onRefresh());
      })
      .catch((err: Error) => setGenError(err.message))
      .finally(() => setGenerating(false));
  };

  const copyNotes = () => {
    if (!row.releaseNotes) return;
    navigator.clipboard
      .writeText(row.releaseNotes)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setGenError('Não foi possível copiar para a área de transferência.'));
  };

  return (
    <aside className="mst-drawer" role="dialog" aria-label={`Milestone ${row.title}`}>
      <div className="mst-drawer__head">
        <span className="mst-dot" style={{ background: `var(${st.varName})` }} />
        <span className="mst-drawer__title">{row.title}</span>
        <button type="button" className="mst-drawer__close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
      </div>

      <div className="mst-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'details'}
          className={`mst-tab${tab === 'details' ? ' mst-tab--on' : ''}`}
          onClick={() => setTab('details')}
        >
          Detalhes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'notes'}
          className={`mst-tab${tab === 'notes' ? ' mst-tab--on' : ''}`}
          onClick={() => setTab('notes')}
        >
          Release Notes
        </button>
      </div>

      {tab === 'details' ? (
        <div className="mst-drawer__body">
          <section className="mst-sec">
            <span className="mst-sec__label">Status</span>
            <span className="mst-pill">
              <span className="mst-dot" style={{ background: `var(${st.varName})` }} />
              {st.label}
            </span>
          </section>

          {row.description && (
            <section className="mst-sec">
              <span className="mst-sec__label">Descrição</span>
              <p className="mst-desc">{row.description}</p>
            </section>
          )}

          <div className="mst-minigrid">
            <div className="mst-mini">
              <span className="mst-mini__label">Início</span>
              <span className="mst-mini__value mono">{fmtFull(row.start)}</span>
            </div>
            <div className="mst-mini">
              <span className="mst-mini__label">ETA</span>
              <span className="mst-mini__value mono mst-mini__value--accent">{fmtFull(row.eta)}</span>
            </div>
            <div className="mst-mini">
              <span className="mst-mini__label">Stories</span>
              <span className="mst-mini__value mono">{row.storyCount}</span>
            </div>
            <div className="mst-mini">
              <span className="mst-mini__label">Story Points</span>
              <span className="mst-mini__value mono">{row.plannedPoints} pts</span>
            </div>
          </div>

          {cap != null && (
            <section className="mst-sec">
              <span className="mst-sec__label">Capacidade</span>
              <div className="mst-cap">
                <div className="mst-cap__track">
                  <div
                    className="mst-cap__fill"
                    style={{
                      width: `${capPct ?? 0}%`,
                      background: capOver ? 'var(--danger)' : 'var(--done)',
                    }}
                  />
                </div>
                <span className="mst-cap__label mono">
                  {row.plannedPoints} / {cap} pts
                </span>
              </div>
            </section>
          )}

          {row.owner && (
            <section className="mst-sec">
              <span className="mst-sec__label">Responsável</span>
              <span className="mst-owner">
                <span className="mst-owner__av">{row.owner.slice(0, 2).toUpperCase()}</span>
                {row.owner}
              </span>
            </section>
          )}

          <section className="mst-sec">
            <span className="mst-sec__label">Stories da release ({stories.length})</span>
            {stories.length === 0 ? (
              <p className="mst-desc">Nenhuma story atribuída a este milestone.</p>
            ) : (
              <ul className="mst-storylist">
                {stories.map((s) => (
                  <li key={s.number} className="mst-storyitem">
                    <a className="mst-storyitem__id" href={hrefForItem(repoId, 'story', s.number)}>
                      #{s.number}
                    </a>
                    <span className="mst-storyitem__title" title={s.title}>
                      {s.title}
                    </span>
                    {s.priority && (
                      <span className={`chip chip--${s.priority.toLowerCase()}`}>{s.priority}</span>
                    )}
                    {(s.state === 'closed' || s.stage === 'Done') && (
                      <span className="chip chip--closed">ok</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="mst-drawer__body">
          <div className="mst-notes__bar">
            {row.releaseNotes && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={copyNotes}
                disabled={generating}
              >
                {copied ? '✓ Copiado' : 'Copiar'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm btn--accent"
              onClick={generate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Gerando…
                </>
              ) : row.releaseNotes ? (
                'Regerar Release Notes'
              ) : (
                'Gerar Release Notes'
              )}
            </button>
          </div>
          {genError && <p className="ai-panel__error">{genError}</p>}
          {row.releaseNotes ? (
            <div className="mst-notes">
              <Mdx source={row.releaseNotes} />
            </div>
          ) : (
            !generating && (
              <p className="mst-desc">
                Ainda não há Release Notes. Clique em “Gerar Release Notes” para a IA criar um texto
                padronizado a partir das {stories.length} stories desta release.
              </p>
            )
          )}
        </div>
      )}

      <div className="mst-drawer__foot">
        <a
          className="btn btn--accent mst-cta"
          href={hrefForWorkspace('pm', 'planning')}
        >
          Abrir Planejamento →
        </a>
        <div className="mst-drawer__actions">
          <button type="button" className="btn btn--sm" onClick={onEdit} disabled={busy}>
            ✎ Editar
          </button>
          <button
            type="button"
            className="btn btn--sm mst-btn-danger"
            onClick={onDelete}
            disabled={busy}
          >
            Excluir
          </button>
        </div>
      </div>
    </aside>
  );
}

// ---------------- Modal criar/editar ----------------

function MilestoneModal({
  repoId,
  initial,
  onClose,
  onDone,
}: {
  repoId: string;
  initial: Row | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [start, setStart] = useState(initial?.start ? toISODate(initial.start) : '');
  const [eta, setEta] = useState(initial?.eta ? toISODate(initial.eta) : '');
  const [capacity, setCapacity] = useState(initial?.capacity != null ? String(initial.capacity) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (!title.trim()) return;
    setSaving(true);
    const capNum = capacity.trim() ? Number(capacity) : null;
    const desc = serializeMilestoneDescription(description, {
      start: start || null,
      capacity: Number.isFinite(capNum as number) ? (capNum as number) : null,
      releaseNotes: initial?.releaseNotes ?? null,
    });
    const dueOn = eta ? `${eta}T00:00:00Z` : null;
    const op = initial
      ? updateMilestone(repoId, initial.number, { title: title.trim(), dueOn, description: desc })
      : createMilestone(repoId, { title: title.trim(), dueOn, description: desc });
    Promise.resolve(op)
      .then(onDone)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mst-modal-backdrop" onMouseDown={onClose}>
      <div className="mst-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mst-modal__head">
          <h3>{initial ? 'Editar Milestone' : 'Nova Milestone'}</h3>
          <button type="button" className="mst-drawer__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="mst-modal__body">
          <label className="mst-field">
            <span>Nome</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="mst-field">
            <span>Descrição</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <div className="mst-field-row">
            <label className="mst-field">
              <span>Início</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="mst-field">
              <span>ETA</span>
              <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
            </label>
            <label className="mst-field">
              <span>Capacidade (pts)</span>
              <input
                type="number"
                min="0"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="mst-modal__foot">
          <button type="button" className="btn btn--sm" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--sm btn--accent"
            onClick={submit}
            disabled={saving || !title.trim()}
          >
            {saving ? 'Salvando…' : initial ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}
