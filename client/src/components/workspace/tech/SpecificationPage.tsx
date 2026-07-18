// Backlog view do Tech Leader (spec "Backlog view — workspace do TL"): o portão
// técnico do fluxo. Espelha a anatomia da Specification do PM com papéis
// invertidos — o TL lê e comenta; NUNCA edita a spec. Duas saídas mutuamente
// exclusivas: "Gerar plan" (aceite técnico) ou "Devolver ao PM" (comentários
// consolidados via rascunhos staged — nada vai à issue antes da devolução).
//
// Escopo: Features na etapa Plan SEM plan.md (com plan.md → Plan view).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { Mdx } from '../../Mdx';
import { DiffPanel } from '../DiffPanel';
import { ToastStack, useToasts } from '../Toasts';
import { isFeature, isOpen, waitingSince } from '../../../lib/workspaceSelectors';
import { createArtifact } from '../../../data/workItem';
import {
  createReviewDraft,
  deleteReviewDraft,
  fetchPlanStatus,
  fetchPreReview,
  fetchReviewCycle,
  fetchReviewDrafts,
  fetchSpecBlob,
  fetchSpecMeta,
  rerunPreReview,
  returnFeatureToPm,
  updateReviewDraft,
  type PlanStatus,
  type PreReviewState,
  type ReviewCycleView,
  type ReviewDraft,
  type SpecMeta,
} from '../../../data/workspace';

const PLAN_LABEL = 'spec-wave:plan';
const POLL_MS = 10_000;
const TOC_MIN_H2 = 6;

type Substate = 'returned' | 'waiting' | 'generating' | 'error';

interface Anchor {
  selectedText: string;
  startLine: number | null;
  endLine: number | null;
  headingPath: string[];
  specSha: string | null;
}

// Localiza o trecho no markdown-fonte (mesma regra da Specification do PM).
function resolveAnchor(source: string, text: string, sha: string | null): Anchor {
  const idx = source.indexOf(text);
  if (idx === -1) return { selectedText: text, startLine: null, endLine: null, headingPath: [], specSha: sha };
  const before = source.slice(0, idx);
  const startLine = before.split('\n').length;
  const endLine = startLine + text.split('\n').length - 1;
  const headingPath: string[] = [];
  for (const line of before.split('\n').reverse()) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      headingPath.unshift(m[2].trim());
      if (m[1].length === 1) break;
    }
  }
  return { selectedText: text, startLine, endLine, headingPath, specSha: sha };
}

function h2Sections(content: string): string[] {
  return [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

// ---------- página ----------

export function SpecificationPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [metaBy, setMetaBy] = useState<Map<number, SpecMeta>>(new Map());
  const [planBy, setPlanBy] = useState<Map<number, PlanStatus>>(new Map());
  const [draftsBy, setDraftsBy] = useState<Map<number, ReviewDraft[]>>(new Map());
  const [cycleBy, setCycleBy] = useState<Map<number, ReviewCycleView | null>>(new Map());
  const [preBy, setPreBy] = useState<Map<number, PreReviewState>>(new Map());
  const [generating, setGenerating] = useState<Set<number>>(new Set());
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const [floatBtn, setFloatBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const [commentDraft, setCommentDraft] = useState<{ anchor: Anchor | null; text: string } | null>(null);
  const [editingDraft, setEditingDraft] = useState<{ id: string; text: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [preOpen, setPreOpen] = useState(true);
  const [planGuard, setPlanGuard] = useState(false); // modal de rascunhos pendentes
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();
  const docRef = useRef<HTMLDivElement>(null);
  const blobCache = useRef<Map<string, string>>(new Map());

  // ---- fila ----
  const scoped = useMemo(
    () =>
      snapshot.items.filter(
        (i) =>
          isFeature(i) &&
          isOpen(i) &&
          i.stage === 'Plan' &&
          !removedLocal.has(i.number) &&
          planBy.get(i.number)?.hasPlan !== true,
      ),
    [snapshot.items, removedLocal, planBy],
  );

  const substateOf = (i: SnapshotItem): Substate => {
    if (generating.has(i.number) || i.labels.includes(PLAN_LABEL)) {
      const run = planBy.get(i.number)?.latestRun;
      if (run?.conclusion === 'failure') return 'error';
      return 'generating';
    }
    if (cycleBy.get(i.number)) return 'returned';
    return 'waiting';
  };

  // Grupos por milestone (ETA asc; "Sem milestone" ao final); interno: retornadas
  // no topo (item mais quente), depois Rank.
  const groups = useMemo(() => {
    const milestones = [...snapshot.milestones]
      .filter((m) => m.state === 'open')
      .sort((a, b) => ((a.dueOn ?? '9999') < (b.dueOn ?? '9999') ? -1 : 1));
    const byMilestone = new Map<number | null, SnapshotItem[]>();
    for (const item of scoped) {
      const key = item.milestone?.number ?? null;
      const bucket = byMilestone.get(key);
      if (bucket) bucket.push(item);
      else byMilestone.set(key, [item]);
    }
    const sortItems = (items: SnapshotItem[]) =>
      items.sort((a, b) => {
        const retA = cycleBy.get(a.number) ? 0 : 1;
        const retB = cycleBy.get(b.number) ? 0 : 1;
        if (retA !== retB) return retA - retB;
        const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
        return ra - rb || (a.createdAt < b.createdAt ? -1 : 1);
      });
    const out: { key: string; title: string | null; items: SnapshotItem[] }[] = [];
    for (const m of milestones) {
      const items = byMilestone.get(m.number);
      if (items?.length) out.push({ key: `m${m.number}`, title: m.title, items: sortItems(items) });
    }
    const none = byMilestone.get(null);
    if (none?.length) out.push({ key: 'none', title: null, items: sortItems(none) });
    return out;
  }, [scoped, snapshot.milestones, cycleBy]);

  const flatQueue = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const returnedCount = flatQueue.filter((i) => cycleBy.get(i.number)).length;

  // Auto-seleção do primeiro acionável.
  useEffect(() => {
    if (flatQueue.length === 0) {
      setSelected(null);
      return;
    }
    if (selected == null || !flatQueue.some((i) => i.number === selected)) {
      const actionable = flatQueue.find((i) => {
        const s = substateOf(i);
        return s === 'returned' || s === 'waiting';
      });
      setSelected((actionable ?? flatQueue[0]).number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatQueue]);

  const selectedItem = selected != null ? flatQueue.find((i) => i.number === selected) ?? null : null;

  // ---- carregamentos por item ----
  const loadDrafts = (n: number) =>
    fetchReviewDrafts(repoId, n)
      .then((d) => setDraftsBy((m) => new Map(m).set(n, d)))
      .catch(() => undefined);

  useEffect(() => {
    if (selected == null) return;
    if (!metaBy.has(selected)) {
      fetchSpecMeta(repoId, selected)
        .then((meta) => {
          setMetaBy((m) => new Map(m).set(selected, meta));
          if (meta.sha && meta.content != null) blobCache.current.set(meta.sha, meta.content);
        })
        .catch((err: Error) => addToast(`Falha ao carregar a spec: ${err.message}`));
    }
    if (!draftsBy.has(selected)) loadDrafts(selected);
    if (!preBy.has(selected)) {
      fetchPreReview(repoId, selected)
        .then((p) => setPreBy((m) => new Map(m).set(selected, p)))
        .catch(() => undefined);
    }
    setFloatBtn(null);
    setCommentDraft(null);
    setShowDiff(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Ciclos de toda a fila (destaque "retornou de devolução").
  useEffect(() => {
    for (const item of scoped) {
      if (!cycleBy.has(item.number)) {
        fetchReviewCycle(repoId, item.number)
          .then((c) => setCycleBy((m) => new Map(m).set(item.number, c)))
          .catch(() => undefined);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped.map((i) => i.number).join(',')]);

  // ---- polling (plan em geração + pré-review pendente) ----
  useEffect(() => {
    const tick = async () => {
      const planTargets = snapshot.items.filter(
        (i) =>
          isFeature(i) &&
          isOpen(i) &&
          i.stage === 'Plan' &&
          !removedLocal.has(i.number) &&
          (planBy.get(i.number) == null ||
            (!planBy.get(i.number)!.hasPlan &&
              (generating.has(i.number) || i.labels.includes(PLAN_LABEL)))),
      );
      for (const item of planTargets) {
        try {
          const st = await fetchPlanStatus(repoId, item.number);
          const before = planBy.get(item.number)?.hasPlan;
          setPlanBy((m) => new Map(m).set(item.number, st));
          if (before === false && st.hasPlan) {
            addToast(`plan.md de #${item.number} gerado — o item migrou para a Plan view.`);
            setGenerating((s) => {
              const next = new Set(s);
              next.delete(item.number);
              return next;
            });
          }
        } catch {
          /* best-effort */
        }
      }
      if (selected != null && preBy.get(selected)?.status === 'pending') {
        fetchPreReview(repoId, selected)
          .then((p) => setPreBy((m) => new Map(m).set(selected, p)))
          .catch(() => undefined);
      }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.items, selected, generating, removedLocal]);

  // ---- seleção de texto → Comentar ----
  const onDocMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !docRef.current) {
      setFloatBtn(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text || !docRef.current.contains(sel.anchorNode)) {
      setFloatBtn(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const cont = docRef.current.getBoundingClientRect();
    setFloatBtn({ x: rect.left - cont.left + rect.width / 2, y: rect.top - cont.top, text });
  };

  const startComment = (anchorText: string | null) => {
    if (selected == null) return;
    const meta = metaBy.get(selected);
    const anchor = anchorText
      ? resolveAnchor(meta?.content ?? '', anchorText, meta?.sha ?? null)
      : null;
    setCommentDraft({ anchor, text: '' });
    setFloatBtn(null);
    window.getSelection()?.removeAllRanges();
  };

  const saveComment = () => {
    if (selected == null || !commentDraft || !commentDraft.text.trim()) return;
    const n = selected;
    createReviewDraft(repoId, n, {
      body: commentDraft.text.trim(),
      anchor: commentDraft.anchor ?? undefined,
      specSha: metaBy.get(n)?.sha ?? null,
    })
      .then(() => {
        setCommentDraft(null);
        loadDrafts(n);
      })
      .catch((err: Error) => addToast(`Falha ao salvar o rascunho: ${err.message}`));
  };

  // ---- devolver ao PM ----
  const doReturn = (item: SnapshotItem) => {
    const n = item.number;
    const count = (draftsBy.get(n) ?? []).length;
    if (count === 0) return;
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(n));
    returnFeatureToPm(repoId, n)
      .then((res) => {
        if (res.ok) {
          addToast(`Devolvida ao PM com ${res.posted} comentário(s).`);
          refresh();
        } else {
          setRemovedLocal((s) => {
            const next = new Set(s);
            next.delete(n);
            return next;
          });
          loadDrafts(n);
          addToast(
            `Falha na devolução (passo: ${res.step}; ${res.posted}/${res.total} publicados): ${res.error ?? 'erro'}. Os rascunhos restantes foram preservados.`,
            { label: 'Tentar novamente', run: () => doReturn(item) },
          );
        }
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(n);
          return next;
        });
        addToast(`Falha na devolução: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => doReturn(item),
        });
      })
      .finally(() => setBusy(false));
  };

  // ---- gerar plan ----
  const startPlan = (item: SnapshotItem) => {
    const n = item.number;
    setGenerating((s) => new Set(s).add(n));
    setPlanGuard(false);
    createArtifact(repoId, n, 'plan')
      .then(() => {
        addToast(`Geração do plan de #${n} disparada.`);
        refresh();
      })
      .catch((err: Error) => {
        setGenerating((s) => {
          const next = new Set(s);
          next.delete(n);
          return next;
        });
        addToast(`Falha ao disparar o plan: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => startPlan(item),
        });
      });
  };

  const onGeneratePlan = (item: SnapshotItem) => {
    const drafts = draftsBy.get(item.number) ?? [];
    if (drafts.length > 0) {
      setPlanGuard(true);
      return;
    }
    startPlan(item);
  };

  const discardAndGenerate = async (item: SnapshotItem) => {
    const n = item.number;
    const drafts = draftsBy.get(n) ?? [];
    setBusy(true);
    try {
      for (const d of drafts) await deleteReviewDraft(repoId, n, d.draftId);
      setDraftsBy((m) => new Map(m).set(n, []));
      startPlan(item);
    } catch (err) {
      addToast(`Falha ao descartar rascunhos: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // ---- achados → rascunho ----
  const commentFinding = (finding: { text: string; anchor: { selectedText?: string } | null }) => {
    if (selected == null) return;
    const n = selected;
    const meta = metaBy.get(n);
    const anchor = finding.anchor?.selectedText
      ? resolveAnchor(meta?.content ?? '', finding.anchor.selectedText, meta?.sha ?? null)
      : null;
    createReviewDraft(repoId, n, {
      body: finding.text,
      anchor: anchor ?? undefined,
      specSha: meta?.sha ?? null,
    })
      .then(() => {
        loadDrafts(n);
        addToast('Achado convertido em rascunho — edite no painel antes de devolver.');
      })
      .catch((err: Error) => addToast(`Falha ao criar o rascunho: ${err.message}`));
  };

  const blobFor = async (sha: string): Promise<string> => {
    const cached = blobCache.current.get(sha);
    if (cached != null) return cached;
    const content = await fetchSpecBlob(repoId, selected as number, sha);
    blobCache.current.set(sha, content);
    return content;
  };

  // ---- render ----
  const meta = selected != null ? metaBy.get(selected) : undefined;
  const drafts = selected != null ? draftsBy.get(selected) ?? [] : [];
  const cycle = selected != null ? cycleBy.get(selected) ?? null : null;
  const pre = selected != null ? preBy.get(selected) : undefined;
  const sub = selectedItem ? substateOf(selectedItem) : null;
  const sections = meta?.content ? h2Sections(meta.content) : [];

  const scrollToSection = (index: number) => {
    docRef.current?.querySelectorAll('h2')?.[index]?.scrollIntoView({ behavior: 'smooth' });
  };

  const triageLabel: Record<string, string> = {
    pending: 'sem triagem',
    accepted: 'aceito',
    dismissed: 'descartado',
    applied: 'aplicado ✓',
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">
          {flatQueue.length} spec{flatQueue.length === 1 ? '' : 's'} aguardando revisão técnica
        </span>
        {returnedCount > 0 && <span className="tl-returned-badge">{returnedCount} retornada(s)</span>}
      </div>

      {flatQueue.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">🧭</span>
          <p>Nenhuma spec aguardando revisão técnica.</p>
          <p className="tl-empty__hint">As aprovações do PM chegam aqui.</p>
        </div>
      ) : (
        <div className="sp-split">
          {/* Fila agrupada por milestone */}
          <aside className="sp-queue">
            {groups.map((g) => (
              <div key={g.key} className="tl-group">
                <div className="tl-group__head">{g.title ?? 'Sem milestone'}</div>
                {g.items.map((item) => {
                  const s = substateOf(item);
                  const v = metaBy.get(item.number)?.versions.length;
                  return (
                    <button
                      key={item.number}
                      type="button"
                      className={[
                        'sp-queue__item',
                        s === 'returned' ? 'tl-queue__item--returned' : `sp-queue__item--${s}`,
                        selected === item.number ? 'sp-queue__item--selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setSelected(item.number)}
                    >
                      <span className="sp-queue__title">
                        <span className="mono">#{item.number}</span> {item.title}
                      </span>
                      <span className="sp-queue__status">
                        {s === 'returned' && 'Retornou de devolução'}
                        {s === 'waiting' && `Aguardando revisão${v ? ` · v${v}` : ''}`}
                        {s === 'generating' && (
                          <>
                            <span className="spinner" aria-hidden="true" /> Gerando plan…
                          </>
                        )}
                        {s === 'error' && '⚠️ Falha na geração do plan'}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          {/* Painel da spec */}
          <section className="sp-doc">
            {!selectedItem ? null : sub === 'error' ? (
              <div className="bl-empty">
                <span className="bl-empty__icon">⚠️</span>
                <p>
                  A geração do plan falhou.
                  {planBy.get(selectedItem.number)?.latestRun?.url && (
                    <>
                      {' '}
                      <a
                        href={planBy.get(selectedItem.number)!.latestRun!.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver execução
                      </a>
                    </>
                  )}
                </p>
                <div className="bl-empty__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--accent"
                    onClick={() => startPlan(selectedItem)}
                  >
                    Reexecutar
                  </button>
                </div>
              </div>
            ) : !meta ? (
              <p className="bl-drawer__loading">
                <span className="spinner" aria-hidden="true" /> Carregando…
              </p>
            ) : (
              <>
                <div className="sp-doc__head">
                  <span className="sp-doc__title">
                    <span className="mono">#{selectedItem.number}</span> {selectedItem.title}
                  </span>
                  <span className="sp-doc__meta">
                    spec.md · v{meta.versions.length}
                    {meta.versions[0] && ` · commitada ${waitingSince(meta.versions[0].committedAt)}`}
                  </span>
                  <span className="ws-toolbar__spacer" />
                  {sub === 'returned' && cycle?.specSha && meta.sha && cycle.specSha !== meta.sha && (
                    <button type="button" className="btn btn--sm" onClick={() => setShowDiff((v) => !v)}>
                      Diff desde minha revisão
                    </button>
                  )}
                  <a
                    className="btn btn--sm"
                    href={`${snapshot.repository.url}/blob/HEAD/${meta.path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver no GitHub
                  </a>
                </div>

                {/* Diff desde minha revisão + triagem do ciclo anterior */}
                {showDiff && cycle?.specSha && meta.sha && (
                  <>
                    <DiffPanel
                      versions={meta.versions}
                      base={cycle.specSha}
                      head={meta.sha}
                      blobFor={blobFor}
                      onPick={() => undefined}
                      onClose={() => setShowDiff(false)}
                    />
                    {cycle.comments.length > 0 && (
                      <div className="tl-cycle">
                        <div className="tl-cycle__head">
                          Meus comentários do ciclo anterior · triagem do PM
                        </div>
                        {cycle.comments.map((c) => (
                          <div key={c.id} className="tl-cycle__item">
                            <span className={`tl-cycle__state tl-cycle__state--${c.state}`}>
                              {triageLabel[c.state]}
                            </span>
                            <span className="tl-cycle__body">{c.body}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* Achados do pré-review IA */}
                <div className="tl-pre">
                  <div className="tl-pre__head">
                    <button type="button" className="tl-pre__toggle" onClick={() => setPreOpen((v) => !v)}>
                      {preOpen ? '▾' : '▸'} ✨ Pré-review IA
                    </button>
                    {pre?.status === 'pending' && (
                      <span className="tl-pre__hint">
                        <span className="spinner" aria-hidden="true" /> em andamento…
                      </span>
                    )}
                    {pre?.status === 'done' && pre.findings.length === 0 && (
                      <span className="tl-pre__hint">nenhum apontamento</span>
                    )}
                    {pre?.status === 'error' && <span className="tl-pre__hint">falhou</span>}
                    <span className="ws-toolbar__spacer" />
                    <button
                      type="button"
                      className="tl-pre__rerun"
                      onClick={() => {
                        if (selected != null) {
                          rerunPreReview(repoId, selected)
                            .then(() =>
                              setPreBy((m) =>
                                new Map(m).set(selected, {
                                  status: 'pending',
                                  specSha: null,
                                  findings: [],
                                }),
                              ),
                            )
                            .catch((err: Error) => addToast(`Falha ao reexecutar: ${err.message}`));
                        }
                      }}
                    >
                      Reexecutar sobre v{meta.versions.length}
                    </button>
                  </div>
                  {preOpen && pre?.status === 'done' && pre.findings.length > 0 && (
                    <div className="tl-pre__list">
                      <p className="tl-pre__disclaimer">
                        Sugestões de atenção geradas por IA — não são veredictos.
                      </p>
                      {pre.findings.map((f, i) => (
                        <div key={i} className={`tl-finding tl-finding--${f.severity}`}>
                          <span className="tl-finding__icon">
                            {f.severity === 'warning' ? '⚠' : 'ℹ'}
                          </span>
                          <span className="tl-finding__text">
                            {f.text}
                            {f.anchor?.selectedText && (
                              <span className="tl-finding__excerpt" title={f.anchor.selectedText}>
                                “{f.anchor.selectedText.slice(0, 80)}
                                {f.anchor.selectedText.length > 80 ? '…' : ''}”
                              </span>
                            )}
                          </span>
                          <button type="button" className="btn btn--sm" onClick={() => commentFinding(f)}>
                            Comentar isto
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sumário */}
                {sections.length >= TOC_MIN_H2 && (
                  <nav className="sp-toc" aria-label="Sumário">
                    {sections.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="sp-toc__link"
                        onClick={() => scrollToSection(i)}
                      >
                        {s}
                      </button>
                    ))}
                  </nav>
                )}

                {/* Documento */}
                <div ref={docRef} className="sp-doc__body" onMouseUp={onDocMouseUp}>
                  {meta.content ? <Mdx source={meta.content} /> : <p>Sem conteúdo.</p>}
                  {floatBtn && (
                    <button
                      type="button"
                      className="sp-floatbtn"
                      style={{ left: floatBtn.x, top: floatBtn.y - 34 }}
                      onClick={() => startComment(floatBtn.text)}
                    >
                      💬 Comentar
                    </button>
                  )}
                </div>

                {/* Input de novo comentário */}
                {commentDraft && (
                  <div className="tl-newcomment">
                    {commentDraft.anchor && (
                      <div className="sp-refine__chip">
                        💬 “{commentDraft.anchor.selectedText.slice(0, 60)}
                        {commentDraft.anchor.selectedText.length > 60 ? '…' : ''}”
                        <button
                          type="button"
                          className="bl-pane__clear"
                          onClick={() => setCommentDraft({ ...commentDraft, anchor: null })}
                          aria-label="Remover âncora"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    <textarea
                      rows={3}
                      value={commentDraft.text}
                      autoFocus
                      placeholder="O que precisa mudar nesta spec?"
                      onChange={(e) => setCommentDraft({ ...commentDraft, text: e.target.value })}
                    />
                    <div className="sp-comment__formactions">
                      <button type="button" className="btn btn--sm" onClick={() => setCommentDraft(null)}>
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm btn--accent"
                        disabled={!commentDraft.text.trim()}
                        onClick={saveComment}
                      >
                        Salvar rascunho
                      </button>
                    </div>
                  </div>
                )}

                {/* Painel de rascunhos */}
                <div className="tl-drafts">
                  <div className="tl-drafts__head">
                    Rascunhos ({drafts.length})
                    <span className="ws-toolbar__spacer" />
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setCommentDraft({ anchor: null, text: '' })}
                    >
                      + Comentário geral
                    </button>
                  </div>
                  {drafts.length === 0 ? (
                    <p className="tl-drafts__empty">
                      Nenhum rascunho — selecione um trecho da spec para comentar.
                    </p>
                  ) : (
                    drafts.map((d) =>
                      editingDraft?.id === d.draftId ? (
                        <div key={d.draftId} className="tl-draft">
                          <textarea
                            rows={2}
                            value={editingDraft.text}
                            onChange={(e) => setEditingDraft({ id: d.draftId, text: e.target.value })}
                          />
                          <div className="sp-comment__formactions">
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() => setEditingDraft(null)}
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm btn--accent"
                              disabled={!editingDraft.text.trim()}
                              onClick={() => {
                                updateReviewDraft(
                                  repoId,
                                  selectedItem.number,
                                  d.draftId,
                                  editingDraft.text.trim(),
                                )
                                  .then(() => {
                                    setEditingDraft(null);
                                    loadDrafts(selectedItem.number);
                                  })
                                  .catch((err: Error) => addToast(`Falha ao editar: ${err.message}`));
                              }}
                            >
                              Salvar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div key={d.draftId} className="tl-draft">
                          {d.anchor?.selectedText && (
                            <span className="tl-draft__excerpt" title={d.anchor.selectedText}>
                              “{d.anchor.selectedText.slice(0, 70)}
                              {d.anchor.selectedText.length > 70 ? '…' : ''}”
                            </span>
                          )}
                          <span className="tl-draft__body">{d.body}</span>
                          <span className="tl-draft__actions">
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() => setEditingDraft({ id: d.draftId, text: d.body })}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() => {
                                deleteReviewDraft(repoId, selectedItem.number, d.draftId)
                                  .then(() => loadDrafts(selectedItem.number))
                                  .catch((err: Error) =>
                                    addToast(`Falha ao descartar: ${err.message}`),
                                  );
                              }}
                            >
                              Descartar
                            </button>
                          </span>
                        </div>
                      ),
                    )
                  )}
                </div>

                {/* Rodapé de ações */}
                <div className="sp-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || drafts.length === 0 || sub === 'generating'}
                    onClick={() => doReturn(selectedItem)}
                  >
                    Devolver ao PM ({drafts.length})
                  </button>
                  <span className="ws-toolbar__spacer" />
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={busy || sub === 'generating' || !meta.content}
                    onClick={() => onGeneratePlan(selectedItem)}
                  >
                    {sub === 'generating' ? (
                      <>
                        <span className="spinner" aria-hidden="true" /> Gerando plan…
                      </>
                    ) : (
                      'Gerar plan'
                    )}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Guarda de rascunhos pendentes ao gerar plan */}
      {planGuard && selectedItem && (
        <div className="mst-modal-backdrop" onMouseDown={() => setPlanGuard(false)}>
          <div
            className="mst-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mst-modal__head">
              <h3>Rascunhos não enviados</h3>
              <button
                type="button"
                className="mst-drawer__close"
                onClick={() => setPlanGuard(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="mst-modal__body">
              <p className="mst-desc">
                Você tem {(draftsBy.get(selectedItem.number) ?? []).length} comentário(s) não
                enviados. As saídas são mutuamente exclusivas: devolver ao PM ou aceitar
                tecnicamente e gerar o plan.
              </p>
            </div>
            <div className="mst-modal__foot">
              <button type="button" className="btn btn--sm" onClick={() => setPlanGuard(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={busy}
                onClick={() => discardAndGenerate(selectedItem)}
              >
                Descartar e gerar plan
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                disabled={busy}
                onClick={() => {
                  setPlanGuard(false);
                  doReturn(selectedItem);
                }}
              >
                Devolver primeiro
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
