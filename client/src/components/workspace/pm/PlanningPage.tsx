// Planning do PM (spec "Tela de Planning"): a mesa de composição de releases —
// responde "cada release está bem composta?". A unidade é a FEATURE: o PM aloca
// Features aprovadas (etapa Plan/Ready) em milestones, remaneja entre releases
// e enxerga o peso em pontos — estimados por IA (~ ✨) antes do decompose,
// reais depois. Consolida as antigas Planning e Planning2; a dimensão de tempo
// (Gantt/datas/Release Notes) pertence à view Milestones.
//
// Fonte de verdade do drag: campo Milestone da issue; a cascata (Stories/Bugs
// filhos) roda no backend em uma operação — falha parcial reverte a Feature
// inteira e informa.

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { MilestoneSummary, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { ToastStack, useToasts } from '../Toasts';
import { isOpen } from '../../../lib/workspaceSelectors';
import { typeSlug } from '../../../lib/workItemType';
import { parseMilestoneMeta, serializeMilestoneDescription } from '../../../lib/milestoneMeta';
import {
  createMilestone,
  fetchEstimatesMeta,
  setEstimate,
  setFeatureMilestone,
  type EstimateMeta,
} from '../../../data/workspace';

const DAY = 86_400_000;
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CHANGES_REQUESTED_LABEL = 'spec:changes-requested';
// Etapas de Feature consideradas "em execução" para o estado do funil.
const EXEC_STAGES = new Set(['Development', 'Code Review', 'QA', 'UAT']);

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS_PT[d.getUTCMonth()]}`;
}

// ---------- modal Novo milestone ----------

function NewMilestoneModal({
  repoId,
  onClose,
  onDone,
}: {
  repoId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [eta, setEta] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (!title.trim()) return;
    setSaving(true);
    const description = serializeMilestoneDescription('', {
      start: start || null,
      capacity: null,
      releaseNotes: null,
    });
    createMilestone(repoId, {
      title: title.trim(),
      dueOn: eta ? `${eta}T00:00:00Z` : null,
      ...(description ? { description } : {}),
    })
      .then(onDone)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="mst-modal-backdrop" onMouseDown={onClose}>
      <div className="mst-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mst-modal__head">
          <h3>Novo milestone</h3>
          <button type="button" className="mst-drawer__close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="mst-modal__body">
          <label className="mst-field">
            <span>Nome</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <div className="mst-field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="mst-field">
              <span>Início (opcional)</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="mst-field">
              <span>ETA (opcional)</span>
              <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
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
            {saving ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- pontos da feature (edição inline da estimativa) ----------

function PointsBadge({
  points,
  onSave,
  meta,
}: {
  points: { value: number; estimated: boolean } | null;
  onSave: ((points: number) => void) | null; // null = não editável (decomposta)
  meta: EstimateMeta | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  if (editing && onSave) {
    return (
      <input
        type="number"
        min="0"
        className="pl-pts__input"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0 && value !== '') onSave(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label="Estimativa em pontos"
      />
    );
  }

  if (!points) {
    return (
      <button
        type="button"
        className="pl-pts pl-pts--pending"
        onClick={
          onSave
            ? () => {
                setValue('');
                setEditing(true);
              }
            : undefined
        }
        title="Estimativa por IA pendente — clique para definir manualmente"
      >
        ✨ estimando…
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`pl-pts${points.estimated ? ' pl-pts--est' : ''}`}
      disabled={!onSave}
      onClick={
        onSave
          ? () => {
              setValue(String(points.value));
              setEditing(true);
            }
          : undefined
      }
      title={
        onSave
          ? `${meta?.origin === 'manual' ? 'Estimativa manual' : 'Estimativa por IA'} — clique para editar`
          : 'Pontos reais (Stories filhas)'
      }
    >
      {points.estimated ? `~${points.value} pts ✨` : `${points.value} pts`}
      {meta?.stale && (
        <span className="pl-pts__stale" title="A spec mudou desde a estimativa">
          ⚠
        </span>
      )}
    </button>
  );
}

// ---------- página ----------

export function PlanningPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [working, setWorking] = useState<SnapshotItem[]>(snapshot.items);
  useEffect(() => setWorking(snapshot.items), [snapshot.items]);

  const [creating, setCreating] = useState(false);
  const [drag, setDrag] = useState<{ number: number; from: number | 'queue' } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | 'queue' | null>(null);
  const [busy, setBusy] = useState(false);
  const [estimatesMeta, setEstimatesMeta] = useState<Map<number, EstimateMeta>>(new Map());
  const { toasts, addToast, dismissToast } = useToasts();

  useEffect(() => {
    fetchEstimatesMeta(repoId)
      .then((list) => setEstimatesMeta(new Map(list.map((m) => [m.issueNumber, m]))))
      .catch(() => undefined);
  }, [repoId, snapshot.generatedAt]);

  // ---- derivações ----
  const features = useMemo(
    () => working.filter((i) => typeSlug(i) === 'feature'),
    [working],
  );

  const childrenOf = (featureNumber: number): SnapshotItem[] =>
    working.filter(
      (i) =>
        i.parentNumber === featureNumber &&
        (typeSlug(i) === 'story' || typeSlug(i) === 'bug'),
    );

  const isDecomposed = (featureNumber: number): boolean =>
    childrenOf(featureNumber).some((c) => typeSlug(c) === 'story');

  // Pontos exibidos: reais (pós-decompose) ou estimados (~ ✨). null = pendente.
  const pointsOf = (f: SnapshotItem): { value: number; estimated: boolean } | null => {
    if (isDecomposed(f.number)) {
      const real = childrenOf(f.number).reduce((sum, c) => sum + (c.points ?? 0), 0);
      return { value: real, estimated: false };
    }
    if (f.estimate != null) return { value: f.estimate, estimated: true };
    return null;
  };

  // Fila "Sem release": aprovadas (Plan/Ready), sem milestone, abertas; por Rank.
  const queue = useMemo(
    () =>
      features
        .filter(
          (f) =>
            isOpen(f) &&
            (f.stage === 'Plan' || f.stage === 'Ready') &&
            !f.milestone,
        )
        .sort((a, b) => {
          const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
          const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
          return ra - rb || (a.createdAt < b.createdAt ? -1 : 1);
        }),
    [features],
  );

  const openMilestones = useMemo(
    () => snapshot.milestones.filter((m) => m.state === 'open'),
    [snapshot.milestones],
  );

  const featuresOf = (m: MilestoneSummary): SnapshotItem[] =>
    features.filter((f) => isOpen(f) && f.milestone?.number === m.number);

  const milestoneItems = (m: MilestoneSummary): SnapshotItem[] =>
    working.filter(
      (i) =>
        i.milestone?.number === m.number &&
        (typeSlug(i) === 'story' || typeSlug(i) === 'bug'),
    );

  interface Totals {
    real: number;
    estimated: number;
    total: number;
    done: number;
    pct: number;
  }
  const totalsOf = (m: MilestoneSummary): Totals => {
    const items = milestoneItems(m);
    const real = items.reduce((sum, i) => sum + (i.points ?? 0), 0);
    const done = items
      .filter((i) => i.stage === 'Done' || i.state === 'closed')
      .reduce((sum, i) => sum + (i.points ?? 0), 0);
    const estimated = featuresOf(m)
      .filter((f) => !isDecomposed(f.number))
      .reduce((sum, f) => sum + (f.estimate ?? 0), 0);
    const total = real + estimated;
    return { real, estimated, total, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  };

  // Status derivado: Em execução quando ≥1 Story do milestone está fora de Ready.
  const statusOf = (m: MilestoneSummary): 'planejada' | 'execucao' =>
    milestoneItems(m).some(
      (i) => typeSlug(i) === 'story' && i.stage != null && i.stage !== 'Ready',
    )
      ? 'execucao'
      : 'planejada';

  // Linha de estado no funil de uma Feature alocada.
  const funnelOf = (f: SnapshotItem): { text: string; returned: boolean } => {
    const returned = f.labels.includes(CHANGES_REQUESTED_LABEL);
    if (returned) return { text: 'Devolvida · em revisão', returned: true };
    if (f.stage === 'Plan') return { text: 'Plan · com tech leader', returned: false };
    if (f.stage === 'Ready') return { text: 'Ready · aguardando pull', returned: false };
    if (f.stage && EXEC_STAGES.has(f.stage)) {
      const p = f.progress && f.progress.total > 0
        ? Math.round((f.progress.completed / f.progress.total) * 100)
        : 0;
      return { text: `Em execução · ${p}%`, returned: false };
    }
    if (f.stage === 'Done') return { text: 'Concluída', returned: false };
    return { text: f.stageRaw ?? f.stage ?? '—', returned: false };
  };

  const stageFriendly = (f: SnapshotItem): string =>
    f.stage === 'Plan' ? 'Spec aprovada' : f.stage === 'Ready' ? 'Ready' : (f.stage ?? '—');

  // ---- mutações ----
  const applyLocalMilestone = (featureNumber: number, m: MilestoneSummary | null) => {
    const childNumbers = childrenOf(featureNumber).map((c) => c.number);
    setWorking((items) =>
      items.map((it) =>
        it.number === featureNumber || childNumbers.includes(it.number)
          ? { ...it, milestone: m ? { number: m.number, title: m.title } : null }
          : it,
      ),
    );
  };

  const moveFeature = (featureNumber: number, target: MilestoneSummary | null) => {
    const feature = features.find((f) => f.number === featureNumber);
    if (!feature) return;
    const origin = feature.milestone;
    if ((origin?.number ?? null) === (target?.number ?? null)) return;

    // Confirmação: origem tem Stories em andamento? (etapa da story fora de Ready)
    if (origin) {
      const inProgress = childrenOf(featureNumber).filter(
        (c) => typeSlug(c) === 'story' && c.stage != null && c.stage !== 'Ready' && c.stage !== 'Done',
      ).length;
      if (inProgress > 0) {
        const dest = target ? `para "${target.title}"` : 'para fora da release';
        if (
          !confirm(
            `#${featureNumber} tem ${inProgress} stories em andamento na "${origin.title}" — mover ${dest} mesmo assim?`,
          )
        )
          return;
      }
    }

    const originalItems = [feature, ...childrenOf(featureNumber)].map((i) => ({ ...i }));
    applyLocalMilestone(featureNumber, target);
    setBusy(true);
    setFeatureMilestone(repoId, featureNumber, target?.number ?? null)
      .then((res) => {
        if (!res.ok) {
          const failed = res.results.filter((r) => !r.ok);
          setWorking((items) =>
            items.map((it) => originalItems.find((o) => o.number === it.number) ?? it),
          );
          addToast(
            `Falha na cascata de #${featureNumber} (sub-item #${failed[0]?.number}): ${failed[0]?.error ?? 'erro'} — nada foi movido.`,
          );
        } else {
          refresh();
        }
      })
      .catch((err: Error) => {
        setWorking((items) =>
          items.map((it) => originalItems.find((o) => o.number === it.number) ?? it),
        );
        addToast(`Falha ao mover #${featureNumber}: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => moveFeature(featureNumber, target),
        });
      })
      .finally(() => setBusy(false));
  };

  const saveEstimate = (featureNumber: number, points: number) => {
    setWorking((items) =>
      items.map((it) => (it.number === featureNumber ? { ...it, estimate: points } : it)),
    );
    setEstimatesMeta((m) =>
      new Map(m).set(featureNumber, { issueNumber: featureNumber, origin: 'manual', stale: false }),
    );
    setEstimate(repoId, featureNumber, points)
      .then(() => refresh())
      .catch((err: Error) => addToast(`Falha ao gravar a estimativa: ${err.message}`));
  };

  // ---- drag-and-drop ----
  const onDragStartFeature = (e: DragEvent, f: SnapshotItem, from: number | 'queue') => {
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ number: f.number, from });
  };
  const onDragEnd = () => {
    setDrag(null);
    setDropTarget(null);
  };
  const onZoneOver = (e: DragEvent, target: number | 'queue') => {
    if (!drag || drag.from === target) return;
    e.preventDefault();
    if (dropTarget !== target) setDropTarget(target);
  };
  const onZoneDrop = (e: DragEvent, target: number | 'queue') => {
    e.preventDefault();
    const d = drag;
    setDrag(null);
    setDropTarget(null);
    if (!d || d.from === target) return;
    const milestone =
      target === 'queue' ? null : openMilestones.find((m) => m.number === target) ?? null;
    if (target !== 'queue' && !milestone) return;
    moveFeature(d.number, milestone);
  };

  // ---- insights (precedência; máx. 1 faixa) ----
  const insight = useMemo((): string | null => {
    // 1. Overcommit (velocidade histórica: milestones fechados, mínimo 2).
    const closed = snapshot.milestones.filter((m) => m.state === 'closed');
    if (closed.length >= 2) {
      const ptsOfClosed = (m: MilestoneSummary) =>
        working
          .filter(
            (i) =>
              i.milestone?.number === m.number &&
              (typeSlug(i) === 'story' || typeSlug(i) === 'bug'),
          )
          .reduce((s, i) => s + (i.points ?? 0), 0);
      const velocity = closed.reduce((s, m) => s + ptsOfClosed(m), 0) / closed.length;

      const durationOf = (m: MilestoneSummary): number | null => {
        const meta = parseMilestoneMeta(m.description);
        if (!meta.start || !m.dueOn) return null;
        const d = (Date.parse(m.dueOn) - Date.parse(`${meta.start}T00:00:00Z`)) / DAY;
        return d > 0 ? d : null;
      };
      const closedDurations = closed.map(durationOf).filter((d): d is number => d != null);
      const avgDuration =
        closedDurations.length > 0
          ? closedDurations.reduce((s, d) => s + d, 0) / closedDurations.length
          : null;

      if (velocity > 0) {
        for (const m of openMilestones) {
          if (featuresOf(m).length === 0) continue;
          const t = totalsOf(m);
          const dur = durationOf(m);
          const ratio = dur != null && avgDuration != null ? dur / avgDuration : 1;
          const budget = velocity * ratio;
          if (t.total > budget) {
            const weeks = dur != null ? Math.max(1, Math.round(dur / 7)) : null;
            return `Release ${m.title} tem ${t.total} pts${weeks ? ` para ${weeks} semanas` : ''}; a média histórica do time é ${Math.round(velocity)}.`;
          }
        }
      }
    }
    // 2. P0 sem release.
    const p0 = queue.filter((f) => f.priority === 'P0').length;
    if (p0 > 0) return `${p0} feature${p0 === 1 ? '' : 's'} P0 aprovada${p0 === 1 ? '' : 's'} ainda sem release.`;
    // 3. Release sem datas.
    for (const m of openMilestones) {
      if (featuresOf(m).length === 0) continue;
      const meta = parseMilestoneMeta(m.description);
      if (!meta.start || !m.dueOn) {
        return `Release ${m.title} não tem datas — defina na timeline.`;
      }
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working, snapshot.milestones, queue, openMilestones]);

  // ---- render ----
  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">
          {openMilestones.length} release{openMilestones.length === 1 ? '' : 's'} abertas ·{' '}
          {queue.length} feature{queue.length === 1 ? '' : 's'} sem release
        </span>
        <span className="ws-toolbar__spacer" />
        <button type="button" className="btn btn--sm btn--accent" onClick={() => setCreating(true)}>
          + Novo milestone
        </button>
      </div>

      {insight && <div className="bl-insights">💡 {insight}</div>}

      {openMilestones.length === 0 && (
        <div className="bl-empty">
          <span className="bl-empty__icon">📦</span>
          <p>
            Nenhuma release criada ainda. Crie um milestone e arraste Features aprovadas para
            compor a primeira release.
          </p>
          <div className="bl-empty__actions">
            <button type="button" className="btn btn--sm btn--accent" onClick={() => setCreating(true)}>
              + Novo milestone
            </button>
          </div>
        </div>
      )}

      <div className="pl-split">
        {/* Fila "Sem release" */}
        <aside
          className={`pl-queue${dropTarget === 'queue' ? ' pl-queue--drop' : ''}`}
          onDragOver={(e) => onZoneOver(e, 'queue')}
          onDragLeave={() => dropTarget === 'queue' && setDropTarget(null)}
          onDrop={(e) => onZoneDrop(e, 'queue')}
        >
          <div className="bl-pane__head">Sem release</div>
          {queue.length === 0 ? (
            <p className="pl-queue__empty">Todas as features aprovadas têm release.</p>
          ) : (
            queue.map((f) => (
              <div
                key={f.number}
                className="pl-card"
                draggable={!busy}
                onDragStart={(e) => onDragStartFeature(e, f, 'queue')}
                onDragEnd={onDragEnd}
              >
                <span className="pl-card__title" title={f.title}>
                  <span className="mono">#{f.number}</span> {f.title}
                </span>
                <span className="pl-card__meta">
                  {stageFriendly(f)} ·{' '}
                  <PointsBadge
                    points={pointsOf(f)}
                    meta={estimatesMeta.get(f.number)}
                    onSave={isDecomposed(f.number) ? null : (pts) => saveEstimate(f.number, pts)}
                  />
                </span>
              </div>
            ))
          )}
          {drag && drag.from !== 'queue' && (
            <div className="pl-dropzone">Solte aqui para tirar da release</div>
          )}
        </aside>

        {/* Grid de milestones */}
        <div className="pl-grid">
          {openMilestones.map((m) => {
            const feats = featuresOf(m);
            const t = totalsOf(m);
            const st = statusOf(m);
            const meta = parseMilestoneMeta(m.description);
            const start = fmtDate(meta.start ? `${meta.start}T00:00:00Z` : null);
            const eta = fmtDate(m.dueOn);
            const isDrop = dropTarget === m.number;
            return (
              <section
                key={m.number}
                className={`pl-ms${isDrop ? ' pl-ms--drop' : ''}`}
                onDragOver={(e) => onZoneOver(e, m.number)}
                onDragLeave={() => dropTarget === m.number && setDropTarget(null)}
                onDrop={(e) => onZoneDrop(e, m.number)}
              >
                <div className="pl-ms__head">
                  <span className="pl-ms__name">{m.title}</span>
                  <span className={`pl-ms__status pl-ms__status--${st}`}>
                    {st === 'execucao' ? 'Em execução' : 'Planejada'}
                  </span>
                </div>
                <div
                  className="pl-ms__meta"
                  title={
                    t.real > 0 && t.estimated > 0
                      ? `${t.real} reais + ${t.estimated} estimados`
                      : undefined
                  }
                >
                  {start ?? '—'} → {eta ?? '—'} · {t.total} pts
                  {t.real > 0 && t.estimated > 0 && (
                    <span className="pl-ms__mix"> ({t.real} reais + {t.estimated} est.)</span>
                  )}
                </div>
                <div className="pl-ms__bar">
                  <div className="pl-ms__fill" style={{ width: `${t.pct}%` }} />
                </div>

                <div className="pl-ms__features">
                  {feats.map((f) => {
                    const funnel = funnelOf(f);
                    return (
                      <div
                        key={f.number}
                        className={`pl-card pl-card--in${funnel.returned ? ' pl-card--returned' : ''}`}
                        draggable={!busy}
                        onDragStart={(e) => onDragStartFeature(e, f, m.number)}
                        onDragEnd={onDragEnd}
                      >
                        <span className="pl-card__title" title={f.title}>
                          <span className="mono">#{f.number}</span> {f.title}
                        </span>
                        <span className="pl-card__meta">
                          {funnel.returned && <span className="pl-card__warn">⚠</span>}
                          {funnel.text} ·{' '}
                          <PointsBadge
                            points={pointsOf(f)}
                            meta={estimatesMeta.get(f.number)}
                            onSave={
                              isDecomposed(f.number) ? null : (pts) => saveEstimate(f.number, pts)
                            }
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className={`pl-dropzone${drag && drag.from !== m.number ? ' pl-dropzone--active' : ''}`}>
                  Solte uma feature aqui
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {creating && (
        <NewMilestoneModal
          repoId={repoId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
