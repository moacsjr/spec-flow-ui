// Prioritization do PM (spec "Tela de Prioritization"): a mesa de decisão que
// transforma prioridade em compromisso de especificação. Features na etapa
// 🎯 Priorizado, agrupadas P0→P3; a saída ("Enviar para spec") consome trabalho
// real — o custo é tornado visível pelo indicador de fila de revisão (WIP
// persuasivo), sem bloquear a decisão.
//
// - Drag pela alça reordena DENTRO do grupo e persiste o Rank (valores esparsos
//   com rebalanceamento client-side quando o intervalo esgota).
// - Select de prioridade move entre grupos (rank = final do destino); "—"
//   devolve ao Backlog (etapa + prioridade limpas) com confirmação.
// - "Tempo aqui" vem da tabela de transições de etapa (GET stage-ages), com
//   "~" para idades aproximadas (itens movidos por fora da UI).

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Priority, SnapshotItem } from '@spec-flow/shared';
import { PRIORITIES } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { hrefForWorkspace } from '../../../lib/router';
import { isOpen } from '../../../lib/workspaceSelectors';
import { typeSlug } from '../../../lib/workItemType';
import { createArtifact } from '../../../data/workItem';
import {
  bulkArchive,
  fetchSpecStatus,
  fetchStageAges,
  setPriority,
  setRank,
  setStage,
  type StageAge,
} from '../../../data/workspace';

const DAY = 86_400_000;
const RANK_STEP = 1000;
const MIN_RANK_GAP = 1; // abaixo disso, rebalanceia o grupo
const HIGH_AGE_WARN_DAYS = 7; // P0/P1
const LOW_AGE_WARN_DAYS = 30; // P2/P3
const P3_EXPIRE_DAYS = 90;
// Limiares do WIP persuasivo (defaults da spec §4.4; configuração por
// repositório no backend é fase 2).
const WIP_WARN = 4;
const WIP_DANGER = 8;
const CHANGES_REQUESTED_LABEL = 'spec:changes-requested';
const COLLAPSE_KEY = 'spec-flow.prio-collapse';

const GROUP_LABEL: Record<Priority, string> = {
  P0: 'P0 · crítico',
  P1: 'P1 · alta',
  P2: 'P2 · média',
  P3: 'P3 · baixa',
};

// Colapso dos grupos por repositório (P0/P1 abertos e P2/P3 colapsados por padrão).
function readGroupCollapse(repoId: string): Record<Priority, boolean> {
  const defaults: Record<Priority, boolean> = { P0: false, P1: false, P2: true, P3: true };
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Partial<Record<Priority, boolean>>>) : {};
    return { ...defaults, ...(all[repoId] ?? {}) };
  } catch {
    return defaults;
  }
}

function writeGroupCollapse(repoId: string, state: Record<Priority, boolean>): void {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ ...all, [repoId]: state }));
  } catch {
    /* storage indisponível */
  }
}

function daysSince(iso: string): number {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

export function PrioritizationPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  // Cópia de trabalho para otimismo (padrão das demais telas do PM).
  const [working, setWorking] = useState<SnapshotItem[]>(snapshot.items);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  useEffect(() => {
    setWorking(snapshot.items);
    setLeaving(new Set());
  }, [snapshot.items]);

  const [areaFilter, setAreaFilter] = useState('');
  const [collapse, setCollapse] = useState<Record<Priority, boolean>>(() =>
    readGroupCollapse(repoId),
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [drawerItem, setDrawerItem] = useState<SnapshotItem | null>(null);
  const [ages, setAges] = useState<Map<number, StageAge>>(new Map());
  const [specReady, setSpecReady] = useState<Map<number, boolean>>(new Map());
  // Override local de ranks (drag otimista antes do snapshot refletir).
  const [rankOverride, setRankOverride] = useState<Map<number, number>>(new Map());
  const [drag, setDrag] = useState<{ number: number; group: Priority } | null>(null);
  const [dropAt, setDropAt] = useState<{ number: number; pos: 'before' | 'after' } | null>(null);
  const { toasts, addToast, dismissToast } = useToasts();
  const specCheckDone = useRef<Set<number>>(new Set());

  // ---- escopo ----
  const prioritized = useMemo(
    () =>
      working.filter(
        (i) => typeSlug(i) === 'feature' && isOpen(i) && i.stage === 'Priorizado',
      ),
    [working],
  );

  const areas = useMemo(
    () => [...new Set(prioritized.map((i) => i.area).filter((a): a is string => a !== null))],
    [prioritized],
  );

  const rankOf = (i: SnapshotItem): number =>
    rankOverride.get(i.number) ?? i.rank ?? Number.MAX_SAFE_INTEGER;

  const groupItems = (p: Priority): SnapshotItem[] =>
    prioritized
      .filter((i) => i.priority === p && (!areaFilter || i.area === areaFilter))
      .sort((a, b) => rankOf(a) - rankOf(b) || (a.createdAt < b.createdAt ? -1 : 1));

  // ---- tempo na etapa ----
  useEffect(() => {
    fetchStageAges(repoId, 'Priorizado')
      .then((list) => setAges(new Map(list.map((a) => [a.number, a]))))
      .catch(() => undefined);
  }, [repoId, snapshot.generatedAt]);

  // ---- fila de revisão (WIP persuasivo) ----
  const specStageFeatures = useMemo(
    () =>
      working.filter(
        (i) =>
          typeSlug(i) === 'feature' &&
          isOpen(i) &&
          i.stage === 'Spec' &&
          !i.labels.includes(CHANGES_REQUESTED_LABEL),
      ),
    [working],
  );

  useEffect(() => {
    for (const item of specStageFeatures) {
      if (specCheckDone.current.has(item.number)) continue;
      specCheckDone.current.add(item.number);
      fetchSpecStatus(repoId, item.number)
        .then((st) => setSpecReady((m) => new Map(m).set(item.number, st.hasSpec)))
        .catch(() => undefined);
    }
  }, [specStageFeatures, repoId]);

  const reviewQueue = specStageFeatures.filter((i) => specReady.get(i.number) === true).length;
  const wipLevel = reviewQueue >= WIP_DANGER ? 'danger' : reviewQueue >= WIP_WARN ? 'warning' : 'neutral';

  // ---- expiração de P3 ----
  const expiredP3 = useMemo(
    () =>
      groupItems('P3').filter((i) => {
        const age = ages.get(i.number);
        return age && daysSince(age.at) > P3_EXPIRE_DAYS;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prioritized, ages, areaFilter, rankOverride],
  );

  // ---- helpers de otimismo ----
  const markLeaving = (n: number) => setLeaving((s) => new Set(s).add(n));
  const restore = (originals: SnapshotItem[]) => {
    setWorking((items) => items.map((it) => originals.find((o) => o.number === it.number) ?? it));
    setLeaving((s) => {
      const next = new Set(s);
      originals.forEach((o) => next.delete(o.number));
      return next;
    });
  };

  // ---- enviar para spec ----
  const sendToSpec = (item: SnapshotItem) => {
    const original = { ...item };
    markLeaving(item.number);
    window.setTimeout(
      () =>
        setWorking((items) =>
          items.map((it) => (it.number === item.number ? { ...it, stage: 'Spec' as const } : it)),
        ),
      200,
    );
    createArtifact(repoId, item.number, 'spec')
      .then(() => {
        addToast(`spec.md sendo gerada para #${item.number}.`, {
          label: 'Ver em Specification',
          run: () => {
            window.location.hash = hrefForWorkspace('pm', 'specification').slice(1);
          },
        });
        refresh();
      })
      .catch((err: Error) => {
        restore([original]);
        addToast(`Falha ao enviar #${item.number} para spec: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => sendToSpec(item),
        });
      });
  };

  const sendBulk = async (numbers?: number[]) => {
    const targets = prioritized.filter((i) => (numbers ?? [...picked]).includes(i.number));
    if (targets.length === 0) return;
    setBusy(true);
    setPicked(new Set());
    const failed: SnapshotItem[] = [];
    for (const item of targets) {
      const original = { ...item };
      markLeaving(item.number);
      setWorking((items) =>
        items.map((it) => (it.number === item.number ? { ...it, stage: 'Spec' as const } : it)),
      );
      try {
        await createArtifact(repoId, item.number, 'spec');
      } catch {
        failed.push(original);
      }
    }
    if (failed.length > 0) {
      restore(failed);
      addToast(`${failed.length} de ${targets.length} envios falharam.`, {
        label: 'Tentar novamente',
        run: () => sendBulk(failed.map((f) => f.number)),
      });
    } else {
      addToast(`${targets.length} feature(s) enviadas para spec.`);
    }
    setBusy(false);
    refresh();
  };

  // ---- troca de prioridade / devolução ----
  const changePriority = (item: SnapshotItem, value: string) => {
    if (value === '') {
      if (!confirm('Remover a prioridade devolve a feature ao backlog.')) return;
      const original = { ...item };
      markLeaving(item.number);
      window.setTimeout(
        () =>
          setWorking((items) =>
            items.map((it) =>
              it.number === item.number
                ? { ...it, stage: 'Backlog' as const, priority: null, rank: null }
                : it,
            ),
          ),
        200,
      );
      setPriority(repoId, 'feature', item.number, null)
        .then(() => setStage(repoId, 'feature', item.number, 'Backlog'))
        .then(() => refresh())
        .catch((err: Error) => {
          restore([original]);
          addToast(`Falha ao devolver #${item.number} ao backlog: ${err.message}`);
        });
      return;
    }

    const target = value as Priority;
    if (target === item.priority) return;
    const original = { ...item };
    const endRank = Date.now(); // final do grupo de destino
    setWorking((items) =>
      items.map((it) => (it.number === item.number ? { ...it, priority: target } : it)),
    );
    setRankOverride((m) => new Map(m).set(item.number, endRank));
    setPriority(repoId, 'feature', item.number, target)
      .then(() => setRank(repoId, 'feature', item.number, endRank))
      .then(() => refresh())
      .catch((err: Error) => {
        restore([original]);
        setRankOverride((m) => {
          const next = new Map(m);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha ao mudar a prioridade de #${item.number}: ${err.message}`);
      });
  };

  // ---- drag de reordenação (dentro do grupo) ----
  const onDragStart = (e: DragEvent, item: SnapshotItem) => {
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ number: item.number, group: item.priority as Priority });
  };
  const onDragOverRow = (e: DragEvent, item: SnapshotItem) => {
    if (!drag || item.priority !== drag.group || item.number === drag.number) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropAt({ number: item.number, pos });
  };
  const onDropRow = (e: DragEvent, item: SnapshotItem) => {
    e.preventDefault();
    const d = drag;
    const at = dropAt;
    setDrag(null);
    setDropAt(null);
    if (!d || !at || item.priority !== d.group) return;

    const group = groupItems(d.group).filter((i) => i.number !== d.number);
    const targetIdx = group.findIndex((i) => i.number === at.number);
    if (targetIdx === -1) return;
    const insertIdx = at.pos === 'before' ? targetIdx : targetIdx + 1;
    const prev = group[insertIdx - 1];
    const next = group[insertIdx];

    const prevRank = prev ? rankOf(prev) : null;
    const nextRank = next && rankOf(next) !== Number.MAX_SAFE_INTEGER ? rankOf(next) : null;

    let newRank: number;
    let needsRebalance = false;
    if (prevRank != null && prevRank !== Number.MAX_SAFE_INTEGER && nextRank != null) {
      newRank = (prevRank + nextRank) / 2;
      if (Math.abs(nextRank - prevRank) < MIN_RANK_GAP) needsRebalance = true;
    } else if (prevRank != null && prevRank !== Number.MAX_SAFE_INTEGER) {
      newRank = prevRank + RANK_STEP;
    } else if (nextRank != null) {
      newRank = nextRank - RANK_STEP;
    } else {
      needsRebalance = true;
      newRank = RANK_STEP;
    }

    if (needsRebalance) {
      // Intervalo esgotado (ou grupo sem ranks): rebalanceia com passos esparsos.
      const ordered = [...group.slice(0, insertIdx), prioritized.find((i) => i.number === d.number)!, ...group.slice(insertIdx)];
      const base = Date.now();
      const overrides = new Map(rankOverride);
      ordered.forEach((it, idx) => overrides.set(it.number, base + idx * RANK_STEP));
      setRankOverride(overrides);
      setBusy(true);
      (async () => {
        try {
          for (let idx = 0; idx < ordered.length; idx += 1) {
            await setRank(repoId, 'feature', ordered[idx].number, base + idx * RANK_STEP);
          }
          refresh();
        } catch (err) {
          addToast(`Falha ao reordenar: ${(err as Error).message}`);
          refresh();
        } finally {
          setBusy(false);
        }
      })();
      return;
    }

    const prevOverride = rankOverride.get(d.number);
    setRankOverride((m) => new Map(m).set(d.number, newRank));
    setRank(repoId, 'feature', d.number, newRank)
      .then(() => refresh())
      .catch((err: Error) => {
        setRankOverride((m) => {
          const next = new Map(m);
          if (prevOverride != null) next.set(d.number, prevOverride);
          else next.delete(d.number);
          return next;
        });
        addToast(`Falha ao persistir a ordem: ${err.message}`);
      });
  };

  // ---- expiração de P3: arquivar todos ----
  const archiveExpired = () => {
    const numbers = expiredP3.map((i) => i.number);
    if (numbers.length === 0) return;
    if (!confirm(`Arquivar ${numbers.length} item(ns) em P3 há mais de ${P3_EXPIRE_DAYS} dias?`)) return;
    setBusy(true);
    setWorking((items) =>
      items.map((it) => (numbers.includes(it.number) ? { ...it, state: 'closed' as const } : it)),
    );
    bulkArchive(repoId, numbers)
      .then((results) => {
        const failed = results.filter((r) => !r.ok).length;
        if (failed > 0) addToast(`${failed} arquivamento(s) falharam.`);
        refresh();
      })
      .catch((err: Error) => {
        addToast(`Falha ao arquivar: ${err.message}`);
        refresh();
      })
      .finally(() => setBusy(false));
  };

  const toggleGroup = (p: Priority) =>
    setCollapse((c) => {
      const next = { ...c, [p]: !c[p] };
      writeGroupCollapse(repoId, next);
      return next;
    });

  const togglePick = (n: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  // ---- insights (WIP > expiração de P3; máx. 1 faixa) ----
  const wipInsight =
    wipLevel === 'danger'
      ? `Fila de revisão com ${reviewQueue} itens — o gargalo do fluxo agora é você. Recomendo revisar antes de enviar novas specs.`
      : wipLevel === 'warning'
        ? `Sua fila de revisão de specs já tem ${reviewQueue} itens. Enviar mais agora pode atrasar o ciclo — considere revisar antes.`
        : null;
  const p3Insight =
    expiredP3.length > 0
      ? `Estes ${expiredP3.length} itens estão em P3 há mais de ${P3_EXPIRE_DAYS} dias — arquivar?`
      : null;

  const total = prioritized.filter((i) => !areaFilter || i.area === areaFilter).length;
  const anyForArea = prioritized.length > 0 && total === 0;

  return (
    <div className="ws-page">
      {/* Cabeçalho */}
      <div className="bl-head">
        <span className="bl-head__count">{total} features priorizadas</span>
        <button
          type="button"
          className={`pr-wip pr-wip--${wipLevel}`}
          onClick={() => {
            window.location.hash = hrefForWorkspace('pm', 'specification').slice(1);
          }}
          title="Abrir a view Specification"
        >
          {reviewQueue} em spec aguardando revisão
        </button>
        <span className="ws-toolbar__spacer" />
        <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} aria-label="Área">
          <option value="">Todas as áreas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>

      {/* Faixa de insights (WIP vence; expiração vira link secundário) */}
      {(wipInsight || p3Insight) && (
        <div className={`bl-insights${wipLevel === 'danger' ? ' pr-insights--danger' : ''}`}>
          💡 {wipInsight ?? p3Insight}
          {wipInsight && p3Insight && (
            <>
              {' '}
              <button type="button" className="pr-insights__link" onClick={() => setPicked(new Set(expiredP3.map((i) => i.number)))}>
                ({expiredP3.length} itens P3 expirados)
              </button>
            </>
          )}
          {!wipInsight && p3Insight && (
            <span className="pr-insights__actions">
              <button type="button" className="btn btn--sm" disabled={busy} onClick={archiveExpired}>
                Arquivar todos
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPicked(new Set(expiredP3.map((i) => i.number)))}
              >
                Selecionar
              </button>
            </span>
          )}
        </div>
      )}

      {/* Barra de ações em lote (discreta) */}
      {picked.size > 0 && (
        <div className="bl-bulkbar">
          <span className="bl-bulkbar__count">{picked.size} selecionada(s)</span>
          <button type="button" className="btn btn--sm btn--accent" disabled={busy} onClick={() => sendBulk()}>
            Enviar para spec ({picked.size})
          </button>
          <button
            type="button"
            className="btn btn--sm bl-bulkbar__clear"
            onClick={() => setPicked(new Set())}
            disabled={busy}
          >
            Limpar seleção
          </button>
        </div>
      )}

      {/* Estados vazios */}
      {prioritized.length === 0 && (
        <div className="bl-empty">
          <span className="bl-empty__icon">🎯</span>
          <p>Nada priorizado — triagem em dia ou backlog parado?</p>
          <div className="bl-empty__actions">
            <a className="btn btn--sm btn--accent" href={hrefForWorkspace('pm', 'backlog')}>
              Ir para o Backlog
            </a>
          </div>
        </div>
      )}
      {anyForArea && (
        <div className="bl-empty">
          <span className="bl-empty__icon">📭</span>
          <p>Nenhuma feature priorizada em {areaFilter}.</p>
          <div className="bl-empty__actions">
            <button type="button" className="btn btn--sm" onClick={() => setAreaFilter('')}>
              Limpar filtro
            </button>
          </div>
        </div>
      )}

      {/* Grupos P0 → P3 */}
      {prioritized.length > 0 &&
        !anyForArea &&
        PRIORITIES.map((p) => {
          const items = groupItems(p);
          if (items.length === 0 && p !== 'P0') return null; // grupo vazio omitido (exceto P0)
          const collapsed = collapse[p];
          return (
            <section key={p} className="pr-group">
              <button type="button" className="pr-group__head" onClick={() => toggleGroup(p)}>
                <span className="pr-group__chevron">{collapsed ? '▸' : '▾'}</span>
                <span className={`pr-badge pr-badge--${p.toLowerCase()}`}>{GROUP_LABEL[p]}</span>
                <span className="pr-group__count">
                  {items.length === 0 && p === 'P0'
                    ? '0 itens · nenhum crítico no momento'
                    : `${items.length} ${items.length === 1 ? 'item' : 'itens'}`}
                </span>
              </button>

              {!collapsed && items.length > 0 && (
                <div className="pr-rows">
                  {items.map((item) => {
                    const age = ages.get(item.number);
                    const days = age ? daysSince(age.at) : null;
                    const warnDays = p === 'P0' || p === 'P1' ? HIGH_AGE_WARN_DAYS : LOW_AGE_WARN_DAYS;
                    const aged = days != null && days > warnDays;
                    const isDrop = dropAt?.number === item.number;
                    return (
                      <div
                        key={item.number}
                        className={[
                          'pr-row',
                          leaving.has(item.number) ? 'pr-row--leaving' : '',
                          drag?.number === item.number ? 'pr-row--dragging' : '',
                          isDrop && dropAt?.pos === 'before' ? 'pr-row--insert-before' : '',
                          isDrop && dropAt?.pos === 'after' ? 'pr-row--insert-after' : '',
                          picked.has(item.number) ? 'pr-row--picked' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onDragOver={(e) => onDragOverRow(e, item)}
                        onDragLeave={() => dropAt?.number === item.number && setDropAt(null)}
                        onDrop={(e) => onDropRow(e, item)}
                      >
                        <input
                          type="checkbox"
                          className="bl-check pr-row__check"
                          checked={picked.has(item.number)}
                          onChange={() => togglePick(item.number)}
                          aria-label={`Selecionar #${item.number}`}
                        />
                        <span
                          className="pr-row__grip"
                          draggable={!busy}
                          onDragStart={(e) => onDragStart(e, item)}
                          onDragEnd={() => {
                            setDrag(null);
                            setDropAt(null);
                          }}
                          title="Arraste para reordenar dentro do grupo"
                        >
                          ⠿
                        </span>
                        <button
                          type="button"
                          className="pr-row__title"
                          onClick={() => setDrawerItem(item)}
                          title={item.title}
                        >
                          <span className="mono">#{item.number}</span> {item.title}
                        </button>
                        <span className="pr-row__area">{item.area ?? '—'}</span>
                        <span
                          className={`pr-row__age mono${aged ? ' pr-row__age--warn' : ''}`}
                          title={age?.approximate ? 'Entrada na etapa estimada' : undefined}
                        >
                          {days == null ? '—' : `${age?.approximate ? '~' : ''}${days}d aqui`}
                        </span>
                        <select
                          className="queue__priosel pr-row__prio"
                          value={p}
                          disabled={busy || leaving.has(item.number)}
                          onChange={(e) => changePriority(item, e.target.value)}
                          aria-label={`Prioridade de #${item.number}`}
                        >
                          {PRIORITIES.map((pp) => (
                            <option key={pp} value={pp}>
                              {pp}
                            </option>
                          ))}
                          <option value="">—</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn--sm btn--accent pr-row__send"
                          disabled={busy || leaving.has(item.number)}
                          onClick={() => sendToSpec(item)}
                        >
                          Enviar para spec
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

      {drawerItem && (
        <FeatureDrawer repoId={repoId} item={drawerItem} onClose={() => setDrawerItem(null)} />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
