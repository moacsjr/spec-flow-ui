// Plan view do Tech Leader (spec "Plan view — workspace do TL"): Features na
// etapa Plan COM plan.md. Responde "este plano aguenta virar trabalho?" e, em
// caso afirmativo, transforma-o em Stories/Tasks com revisão humana antes da
// materialização. O TL é DONO do plan (refina direto, sem devolução); a spec
// permanece do PM (aba Spec mantém a rota de devolução).
//
// Rodapé progressivo: Aprovar plano → Gerar decomposição → Criar issues (n/m).
// Decomposição em duas fases (nota §9): proposta LLM editável + materialização
// sequencial idempotente via API (retomada sem duplicar nem apagar).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { Mdx } from '../../Mdx';
import { DiffPanel } from '../DiffPanel';
import { ToastStack, useToasts } from '../Toasts';
import { isFeature, isOpen, waitingSince } from '../../../lib/workspaceSelectors';
import { approvePlan, refineArtifact, saveArtifact } from '../../../data/workItem';
import {
  createReviewDraft,
  deleteReviewDraft,
  fetchDecomposition,
  fetchPlanBlob,
  fetchPlanMeta,
  fetchPlanStatus,
  fetchPlanValidation,
  fetchReviewDrafts,
  fetchSpecMeta,
  generateDecomposition,
  materializeDecomposition,
  returnFeatureToPm,
  saveDecomposition,
  updateReviewDraft,
  type DecompositionProposal,
  type PlanValidation,
  type PlanStatus,
  type ProposalStory,
  type ReviewDraft,
  type SpecMeta,
} from '../../../data/workspace';

const READY_LABEL = 'spec-wave:ready';
const POLL_MS = 10_000;
const FIB = [1, 2, 3, 5, 8, 13, 21];

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : t;
}

function tempId(): string {
  return `manual-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- página ----------

export function TechnicalReviewPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<'plan' | 'spec'>('plan');
  const [planMetaBy, setPlanMetaBy] = useState<Map<number, SpecMeta>>(new Map());
  const [specMetaBy, setSpecMetaBy] = useState<Map<number, SpecMeta>>(new Map());
  const [planBy, setPlanBy] = useState<Map<number, PlanStatus>>(new Map());
  const [proposalBy, setProposalBy] = useState<Map<number, DecompositionProposal | null>>(new Map());
  const [draftsBy, setDraftsBy] = useState<Map<number, ReviewDraft[]>>(new Map());
  const [validation, setValidation] = useState<PlanValidation | null>(null);
  const [refining, setRefining] = useState(false);
  const [approving, setApproving] = useState<Set<number>>(new Set());
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [floatBtn, setFloatBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const [anchorText, setAnchorText] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ base: string; head: string } | null>(null);
  const [editCount, setEditCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();
  const docRef = useRef<HTMLDivElement>(null);
  const blobCache = useRef<Map<string, string>>(new Map());

  // ---- fila: etapa Plan COM plan.md ----
  const scoped = useMemo(
    () =>
      snapshot.items.filter(
        (i) =>
          isFeature(i) &&
          isOpen(i) &&
          i.stage === 'Plan' &&
          !removedLocal.has(i.number) &&
          planBy.get(i.number)?.hasPlan === true,
      ),
    [snapshot.items, removedLocal, planBy],
  );

  // Descobre hasPlan de todas as candidatas (uma vez + polling leve).
  useEffect(() => {
    const tick = () => {
      for (const item of snapshot.items) {
        if (!isFeature(item) || !isOpen(item) || item.stage !== 'Plan') continue;
        if (planBy.get(item.number)?.hasPlan === true) continue;
        fetchPlanStatus(repoId, item.number)
          .then((st) => setPlanBy((m) => new Map(m).set(item.number, st)))
          .catch(() => undefined);
      }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.items, repoId]);

  // Grupos por milestone (mesma agregação da Backlog view do TL).
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
  }, [scoped, snapshot.milestones]);

  const flatQueue = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (flatQueue.length === 0) {
      setSelected(null);
      return;
    }
    if (selected == null || !flatQueue.some((i) => i.number === selected)) {
      setSelected(flatQueue[0].number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatQueue]);

  const selectedItem = selected != null ? flatQueue.find((i) => i.number === selected) ?? null : null;

  // ---- carregamentos do selecionado ----
  const loadPlanMeta = async (n: number): Promise<SpecMeta> => {
    const meta = await fetchPlanMeta(repoId, n);
    setPlanMetaBy((m) => new Map(m).set(n, meta));
    if (meta.sha && meta.content != null) blobCache.current.set(meta.sha, meta.content);
    return meta;
  };
  const loadProposal = (n: number) =>
    fetchDecomposition(repoId, n)
      .then((p) => setProposalBy((m) => new Map(m).set(n, p)))
      .catch(() => undefined);
  const loadDrafts = (n: number) =>
    fetchReviewDrafts(repoId, n)
      .then((d) => setDraftsBy((m) => new Map(m).set(n, d)))
      .catch(() => undefined);

  useEffect(() => {
    if (selected == null) return;
    if (!planMetaBy.has(selected))
      loadPlanMeta(selected).catch((err: Error) => addToast(`Falha ao carregar o plan: ${err.message}`));
    if (!specMetaBy.has(selected)) {
      fetchSpecMeta(repoId, selected)
        .then((meta) => setSpecMetaBy((m) => new Map(m).set(selected, meta)))
        .catch(() => undefined);
    }
    if (!proposalBy.has(selected)) loadProposal(selected);
    if (!draftsBy.has(selected)) loadDrafts(selected);
    setFloatBtn(null);
    setAnchorText(null);
    setDiff(null);
    setEditCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Polling: validação (quando aprovando) + proposta (pending/materializing).
  useEffect(() => {
    const tick = () => {
      if (selected == null) return;
      const item = flatQueue.find((i) => i.number === selected);
      if (item && (approving.has(selected) || item.labels.includes(READY_LABEL))) {
        fetchPlanValidation(repoId).then(setValidation).catch(() => undefined);
      }
      const prop = proposalBy.get(selected);
      if (prop && (prop.status === 'pending' || prop.status === 'materializing')) {
        loadProposal(selected);
      }
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, approving, proposalBy, flatQueue]);

  // ---- refino do plan (global + trecho, com guarda de aprovação) ----
  const isApproved = selectedItem?.labels.includes(READY_LABEL) ?? false;

  const runRefine = async (n: number, userPrompt: string, anchor: string | null) => {
    const meta = planMetaBy.get(n);
    if (!meta?.content) return;
    if (isApproved && !confirm('O plano está aprovado; refinar exigirá nova aprovação.')) return;
    setRefining(true);
    try {
      let newContent: string;
      if (anchor && meta.content.includes(anchor)) {
        // Refino ancorado: refina SÓ o trecho e recostura (resto byte a byte).
        const guard = [
          'Você está editando APENAS um trecho de um plano técnico maior.',
          'Devolva SOMENTE o trecho revisado, sem cercas de código nem comentários extras.',
          '',
          `Ajuste pedido: ${userPrompt}`,
        ].join('\n');
        const refined = stripFences(await refineArtifact(repoId, n, 'plan', guard, anchor));
        const fresh = await fetchPlanMeta(repoId, n);
        const target = fresh.content ?? '';
        const idx = target.indexOf(anchor);
        if (idx === -1) {
          setRefining(false);
          addToast('O plano mudou e o trecho não foi re-localizado.', {
            label: 'Enviar como refino global citando o trecho',
            run: () => runRefine(n, `${userPrompt}\n\nTrecho referido:\n"""\n${anchor}\n"""`, null),
          });
          return;
        }
        newContent = target.slice(0, idx) + refined + target.slice(idx + anchor.length);
      } else {
        newContent = stripFences(await refineArtifact(repoId, n, 'plan', userPrompt, meta.content));
      }
      const prevSha = meta.sha;
      await saveArtifact(repoId, n, 'plan', newContent);
      const updated = await loadPlanMeta(n);
      setPrompt('');
      setAnchorText(null);
      if (prevSha && updated.sha && updated.sha !== prevSha) setDiff({ base: prevSha, head: updated.sha });
      loadProposal(n); // proposta pode ter sido invalidada pelo backend
      refresh(); // spec-wave:ready removido no backend
      addToast(`Refino aplicado — v${updated.versions.length} do plan commitada.`);
    } catch (err) {
      addToast(`Falha no refino: ${(err as Error).message}`, {
        label: 'Tentar novamente',
        run: () => runRefine(n, userPrompt, anchor),
      });
    } finally {
      setRefining(false);
    }
  };

  // ---- aprovação ----
  const doApprove = (item: SnapshotItem) => {
    const n = item.number;
    setApproving((s) => new Set(s).add(n));
    approvePlan(repoId, n)
      .then(() => {
        addToast(`Validação de #${n} disparada (spec-wave:ready).`);
        refresh();
      })
      .catch((err: Error) => {
        setApproving((s) => {
          const next = new Set(s);
          next.delete(n);
          return next;
        });
        addToast(`Falha ao aprovar: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => doApprove(item),
        });
      });
  };

  // ---- proposta: edições ----
  const proposal = selected != null ? proposalBy.get(selected) ?? null : null;
  const editable = proposal?.status === 'draft';

  const mutateStories = (fn: (stories: ProposalStory[]) => ProposalStory[]) => {
    if (selected == null || !proposal) return;
    const next = fn(structuredClone(proposal.stories));
    setProposalBy((m) => new Map(m).set(selected, { ...proposal, stories: next }));
    setEditCount((c) => c + 1);
    saveDecomposition(repoId, selected, next).catch((err: Error) =>
      addToast(`Falha ao salvar a edição: ${err.message}`),
    );
  };

  const regenerate = (item: SnapshotItem) => {
    const warn =
      editCount > 0
        ? `A proposta tem ${editCount} edições suas — regerar as descarta. Continuar?`
        : 'Regerar descarta a proposta atual. Continuar?';
    if (!confirm(warn)) return;
    setBusy(true);
    generateDecomposition(repoId, item.number)
      .then(() => {
        setEditCount(0);
        loadProposal(item.number);
      })
      .catch((err: Error) => addToast(`Falha ao regerar: ${err.message}`))
      .finally(() => setBusy(false));
  };

  const materialize = (item: SnapshotItem) => {
    setBusy(true);
    materializeDecomposition(repoId, item.number)
      .then(() => loadProposal(item.number))
      .catch((err: Error) => addToast(`Falha ao materializar: ${err.message}`))
      .finally(() => setBusy(false));
  };

  // Conclusão da materialização: item sai da fila.
  useEffect(() => {
    if (selected == null) return;
    const prop = proposalBy.get(selected);
    if (prop?.status === 'done' && !removedLocal.has(selected)) {
      addToast(`#${selected} decomposta: ${prop.stories.length} stories no backlog técnico.`);
      setRemovedLocal((s) => new Set(s).add(selected));
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalBy, selected]);

  // ---- aba Spec: devolução ----
  const drafts = selected != null ? draftsBy.get(selected) ?? [] : [];
  const doReturnSpec = (item: SnapshotItem) => {
    if (drafts.length === 0) return;
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(item.number));
    returnFeatureToPm(repoId, item.number)
      .then((res) => {
        if (res.ok) {
          addToast(`Spec devolvida ao PM com ${res.posted} comentário(s) — o plan.md permanece.`);
          refresh();
        } else {
          setRemovedLocal((s) => {
            const next = new Set(s);
            next.delete(item.number);
            return next;
          });
          addToast(`Falha na devolução (passo ${res.step}): ${res.error ?? 'erro'}.`);
        }
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha na devolução: ${err.message}`);
      })
      .finally(() => setBusy(false));
  };

  // ---- seleção de trecho (aba Plan) ----
  const onDocMouseUp = () => {
    if (tab !== 'plan') return;
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

  const blobFor = async (sha: string): Promise<string> => {
    const cached = blobCache.current.get(sha);
    if (cached != null) return cached;
    const content = await fetchPlanBlob(repoId, selected as number, sha);
    blobCache.current.set(sha, content);
    return content;
  };

  // ---- derivados de render ----
  const planMeta = selected != null ? planMetaBy.get(selected) : undefined;
  const specMeta = selected != null ? specMetaBy.get(selected) : undefined;
  const isValidating =
    selectedItem != null &&
    approving.has(selectedItem.number) &&
    !selectedItem.labels.includes(READY_LABEL);
  const specNewerThanPlan =
    specMeta?.versions[0] &&
    planMeta?.versions[0] &&
    specMeta.versions[0].committedAt > planMeta.versions[0].committedAt;

  const totals = proposal
    ? {
        stories: proposal.stories.length,
        tasks: proposal.stories.reduce((s, st) => s + st.tasks.length, 0),
        pts: proposal.stories.reduce((s, st) => s + st.points, 0),
        created:
          proposal.stories.filter((s) => s.issueNumber).length +
          proposal.stories.reduce((s, st) => s + st.tasks.filter((t) => t.issueNumber).length, 0),
      }
    : null;

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">
          {flatQueue.length} plano{flatQueue.length === 1 ? '' : 's'} em revisão técnica
        </span>
      </div>

      {flatQueue.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">📐</span>
          <p>Nenhum plano aguardando.</p>
          <p className="tl-empty__hint">Os planos gerados na Backlog view chegam aqui.</p>
        </div>
      ) : (
        <div className="sp-split">
          {/* Fila */}
          <aside className="sp-queue">
            {groups.map((g) => (
              <div key={g.key} className="tl-group">
                <div className="tl-group__head">{g.title ?? 'Sem milestone'}</div>
                {g.items.map((item) => {
                  const prop = item.number === selected ? proposal : proposalBy.get(item.number);
                  const status = item.labels.includes(READY_LABEL)
                    ? prop?.status === 'materializing'
                      ? 'Criando issues…'
                      : prop?.status === 'error' && prop.stories.some((s) => s.issueNumber)
                        ? 'Criação incompleta'
                        : prop?.status === 'draft' || prop?.status === 'invalidated'
                          ? 'Proposta em edição'
                          : 'Aprovado ✓'
                    : approving.has(item.number)
                      ? 'Validando…'
                      : 'Plan em revisão';
                  return (
                    <button
                      key={item.number}
                      type="button"
                      className={`sp-queue__item${selected === item.number ? ' sp-queue__item--selected' : ''}`}
                      onClick={() => setSelected(item.number)}
                    >
                      <span className="sp-queue__title">
                        <span className="mono">#{item.number}</span> {item.title}
                      </span>
                      <span className="sp-queue__status">{status}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          {/* Painel */}
          <section className="sp-doc">
            {!selectedItem ? null : (
              <>
                {/* Abas */}
                <div className="mst-seg" role="tablist" aria-label="Documento">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'plan'}
                    className={`mst-seg__btn${tab === 'plan' ? ' mst-seg__btn--on' : ''}`}
                    onClick={() => setTab('plan')}
                  >
                    Plan
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'spec'}
                    className={`mst-seg__btn${tab === 'spec' ? ' mst-seg__btn--on' : ''}`}
                    onClick={() => setTab('spec')}
                  >
                    Spec
                  </button>
                </div>

                {specNewerThanPlan && tab === 'plan' && (
                  <div className="bl-insights">
                    ⚠️ A spec mudou desde a geração do plano — considere refinar ou regerar o plan.
                  </div>
                )}

                {tab === 'plan' && planMeta && (
                  <>
                    <div className="sp-doc__head">
                      <span className="sp-doc__title">
                        <span className="mono">#{selectedItem.number}</span> {selectedItem.title}
                      </span>
                      <span className="sp-doc__meta">
                        plan.md · v{planMeta.versions.length}
                        {planMeta.versions[0] &&
                          ` · commitada ${waitingSince(planMeta.versions[0].committedAt)}`}
                      </span>
                      <span className="ws-toolbar__spacer" />
                      <a
                        className="btn btn--sm"
                        href={`${snapshot.repository.url}/blob/HEAD/${planMeta.path}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver no GitHub
                      </a>
                    </div>

                    {diff && planMeta.versions.length >= 2 && (
                      <DiffPanel
                        versions={planMeta.versions}
                        base={diff.base}
                        head={diff.head}
                        blobFor={blobFor}
                        onPick={(base, head) => setDiff({ base, head })}
                        onClose={() => setDiff(null)}
                      />
                    )}

                    <div
                      ref={docRef}
                      className={`sp-doc__body${refining ? ' sp-doc__body--locked' : ''}`}
                      onMouseUp={onDocMouseUp}
                    >
                      {planMeta.content ? <Mdx source={planMeta.content} /> : <p>Sem conteúdo.</p>}
                      {floatBtn && !refining && (
                        <button
                          type="button"
                          className="sp-floatbtn"
                          style={{ left: floatBtn.x, top: floatBtn.y - 34 }}
                          onClick={() => {
                            setAnchorText(floatBtn.text);
                            setFloatBtn(null);
                            window.getSelection()?.removeAllRanges();
                          }}
                        >
                          ✂️ Refinar trecho
                        </button>
                      )}
                      {refining && (
                        <div className="sp-doc__lock" role="status">
                          <span className="spinner" aria-hidden="true" /> Refinando o plan…
                        </div>
                      )}
                    </div>

                    {/* Campo de refino */}
                    <div className="sp-refine">
                      {anchorText && (
                        <div className="sp-refine__chip">
                          ✂️ “{anchorText.slice(0, 60)}
                          {anchorText.length > 60 ? '…' : ''}”
                          <button
                            type="button"
                            className="bl-pane__clear"
                            onClick={() => setAnchorText(null)}
                            aria-label="Descartar trecho"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                      <div className="sp-refine__row">
                        <input
                          type="text"
                          value={prompt}
                          disabled={refining || !planMeta.content}
                          placeholder={
                            anchorText ? 'O que mudar neste trecho?' : 'Descreva o ajuste do plano'
                          }
                          onChange={(e) => setPrompt(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && prompt.trim() && !refining) {
                              runRefine(selectedItem.number, prompt.trim(), anchorText);
                            }
                          }}
                          aria-label="Pedido de refino do plan"
                        />
                        <button
                          type="button"
                          className="btn btn--sm btn--accent"
                          disabled={refining || !prompt.trim() || !planMeta.content}
                          onClick={() => runRefine(selectedItem.number, prompt.trim(), anchorText)}
                        >
                          {refining ? (
                            <>
                              <span className="spinner" aria-hidden="true" /> Refinando…
                            </>
                          ) : (
                            'Refinar'
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {tab === 'spec' && (
                  <>
                    <div className="sp-doc__head">
                      <span className="sp-doc__meta">
                        spec.md (somente leitura — a spec é do PM)
                        {specMeta?.versions[0] &&
                          ` · v${specMeta.versions.length} · ${waitingSince(specMeta.versions[0].committedAt)}`}
                      </span>
                      <span className="ws-toolbar__spacer" />
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={busy || drafts.length === 0}
                        onClick={() => doReturnSpec(selectedItem)}
                      >
                        Devolver ao PM ({drafts.length})
                      </button>
                    </div>
                    <div className="sp-doc__body">
                      {specMeta?.content ? <Mdx source={specMeta.content} /> : <p>Sem spec.</p>}
                    </div>
                    {/* Rascunhos da spec (mesma mecânica da Backlog view) */}
                    <div className="tl-drafts">
                      <div className="tl-drafts__head">
                        Rascunhos ({drafts.length})
                        <span className="ws-toolbar__spacer" />
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={() => {
                            const body = window.prompt('Comentário para o PM:');
                            if (body?.trim()) {
                              createReviewDraft(repoId, selectedItem.number, {
                                body: body.trim(),
                                specSha: specMeta?.sha ?? null,
                              })
                                .then(() => loadDrafts(selectedItem.number))
                                .catch((err: Error) => addToast(`Falha: ${err.message}`));
                            }
                          }}
                        >
                          + Comentário
                        </button>
                      </div>
                      {drafts.map((d) => (
                        <div key={d.draftId} className="tl-draft">
                          <span className="tl-draft__body">{d.body}</span>
                          <span className="tl-draft__actions">
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() => {
                                const body = window.prompt('Editar comentário:', d.body);
                                if (body?.trim()) {
                                  updateReviewDraft(repoId, selectedItem.number, d.draftId, body.trim())
                                    .then(() => loadDrafts(selectedItem.number))
                                    .catch((err: Error) => addToast(`Falha: ${err.message}`));
                                }
                              }}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              onClick={() =>
                                deleteReviewDraft(repoId, selectedItem.number, d.draftId)
                                  .then(() => loadDrafts(selectedItem.number))
                                  .catch((err: Error) => addToast(`Falha: ${err.message}`))
                              }
                            >
                              Descartar
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Relatório de validação reprovada */}
                {tab === 'plan' && !isApproved && validation?.report && !validation.report.passed && (
                  <div className="tl-validation">
                    <div className="tl-validation__head">Validação reprovada</div>
                    {validation.report.issues.map((iss, i) => (
                      <div key={i} className="tl-validation__issue">
                        <span className="chip">{iss.document}</span> {iss.message}{' '}
                        {validation.latestRun?.url && (
                          <a href={validation.latestRun.url} target="_blank" rel="noreferrer">
                            Ver execução
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Painel de proposta */}
                {tab === 'plan' && proposal && proposal.status !== 'pending' && (
                  <div className="tl-proposal">
                    <div className="tl-proposal__head">
                      Proposta de decomposição
                      {proposal.status === 'invalidated' && (
                        <span className="tl-proposal__warn">⚠ o plano mudou desde a proposta</span>
                      )}
                      {proposal.status === 'error' && (
                        <span className="tl-proposal__warn">⚠ {proposal.error}</span>
                      )}
                      <span className="ws-toolbar__spacer" />
                      {(proposal.status === 'draft' ||
                        proposal.status === 'invalidated' ||
                        proposal.status === 'error') && (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={busy}
                          onClick={() => regenerate(selectedItem)}
                        >
                          Regerar
                        </button>
                      )}
                    </div>

                    {proposal.stories.map((story, si) => (
                      <div key={story.tempId} className="tl-story">
                        <div className="tl-story__row">
                          {story.issueNumber ? (
                            <span className="mono tl-story__issue">#{story.issueNumber}</span>
                          ) : (
                            <span className="proj-badge proj-badge--story">S</span>
                          )}
                          {editable ? (
                            <input
                              type="text"
                              className="tl-story__title"
                              value={story.title}
                              onChange={(e) =>
                                mutateStories((ss) => {
                                  ss[si].title = e.target.value;
                                  return ss;
                                })
                              }
                            />
                          ) : (
                            <span className="tl-story__title">{story.title}</span>
                          )}
                          {editable ? (
                            <select
                              className="queue__priosel"
                              value={story.points}
                              onChange={(e) =>
                                mutateStories((ss) => {
                                  ss[si].points = Number(e.target.value);
                                  return ss;
                                })
                              }
                              aria-label="Pontos"
                            >
                              {FIB.map((f) => (
                                <option key={f} value={f}>
                                  {f} pts
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="mono">{story.points} pts</span>
                          )}
                          {editable && (
                            <span className="tl-story__tools">
                              {si > 0 && (
                                <>
                                  <button
                                    type="button"
                                    className="tl-story__tool"
                                    title="Mover para cima"
                                    onClick={() =>
                                      mutateStories((ss) => {
                                        [ss[si - 1], ss[si]] = [ss[si], ss[si - 1]];
                                        return ss;
                                      })
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    className="tl-story__tool"
                                    title="Fundir na story anterior (move as tasks)"
                                    onClick={() =>
                                      mutateStories((ss) => {
                                        ss[si - 1].tasks.push(...ss[si].tasks);
                                        ss.splice(si, 1);
                                        return ss;
                                      })
                                    }
                                  >
                                    ⤴ fundir
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="tl-story__tool"
                                title="Remover story"
                                onClick={() =>
                                  mutateStories((ss) => {
                                    ss.splice(si, 1);
                                    return ss;
                                  })
                                }
                              >
                                ✕
                              </button>
                            </span>
                          )}
                        </div>
                        <ul className="tl-tasks">
                          {story.tasks.map((task, ti) => (
                            <li key={task.tempId} className="tl-task">
                              {task.issueNumber ? (
                                <span className="mono tl-story__issue">#{task.issueNumber}</span>
                              ) : (
                                <span className="tl-task__dot">·</span>
                              )}
                              {editable ? (
                                <input
                                  type="text"
                                  className="tl-task__title"
                                  value={task.title}
                                  onChange={(e) =>
                                    mutateStories((ss) => {
                                      ss[si].tasks[ti].title = e.target.value;
                                      return ss;
                                    })
                                  }
                                />
                              ) : (
                                <span className="tl-task__title">{task.title}</span>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  className="tl-story__tool"
                                  title="Remover task"
                                  onClick={() =>
                                    mutateStories((ss) => {
                                      ss[si].tasks.splice(ti, 1);
                                      return ss;
                                    })
                                  }
                                >
                                  ✕
                                </button>
                              )}
                            </li>
                          ))}
                          {editable && (
                            <li>
                              <button
                                type="button"
                                className="tl-proposal__add"
                                onClick={() =>
                                  mutateStories((ss) => {
                                    ss[si].tasks.push({ tempId: tempId(), title: 'Nova task' });
                                    return ss;
                                  })
                                }
                              >
                                + Task
                              </button>
                            </li>
                          )}
                        </ul>
                      </div>
                    ))}

                    {editable && (
                      <button
                        type="button"
                        className="tl-proposal__add"
                        onClick={() =>
                          mutateStories((ss) => {
                            ss.push({
                              tempId: tempId(),
                              title: 'Nova story',
                              userStory: '',
                              points: 3,
                              origin: 'manual',
                              tasks: [],
                            });
                            return ss;
                          })
                        }
                      >
                        + Story manual
                      </button>
                    )}

                    {totals && (
                      <div className="tl-proposal__totals">
                        {totals.stories} stories · {totals.tasks} tasks · {totals.pts} pts
                        {proposal.status === 'materializing' && (
                          <span className="tl-pre__hint">
                            <span className="spinner" aria-hidden="true" /> Criando issues…{' '}
                            {totals.created}/{totals.stories + totals.tasks}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'plan' && proposal?.status === 'pending' && (
                  <p className="bl-drawer__loading">
                    <span className="spinner" aria-hidden="true" /> Gerando proposta de decomposição…
                  </p>
                )}

                {/* Rodapé progressivo */}
                {tab === 'plan' && (
                  <div className="sp-actions">
                    {isApproved && <span className="tl-approved">Plano aprovado ✓</span>}
                    <span className="ws-toolbar__spacer" />
                    {!isApproved ? (
                      <button
                        type="button"
                        className="btn btn--accent"
                        disabled={busy || refining || isValidating || !planMeta?.content}
                        onClick={() => doApprove(selectedItem)}
                      >
                        {isValidating ? (
                          <>
                            <span className="spinner" aria-hidden="true" /> Validando…
                          </>
                        ) : (
                          'Aprovar plano'
                        )}
                      </button>
                    ) : !proposal ||
                      (proposal.status === 'error' && !proposal.stories.some((s) => s.issueNumber)) ? (
                      <button
                        type="button"
                        className="btn btn--accent"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          generateDecomposition(repoId, selectedItem.number)
                            .then(() => loadProposal(selectedItem.number))
                            .catch((err: Error) => addToast(`Falha: ${err.message}`))
                            .finally(() => setBusy(false));
                        }}
                      >
                        Gerar decomposição
                      </button>
                    ) : proposal.status === 'draft' ? (
                      <button
                        type="button"
                        className="btn btn--accent"
                        disabled={busy || totals == null || totals.stories === 0}
                        onClick={() => materialize(selectedItem)}
                      >
                        Criar issues ({totals?.stories} stories, {totals?.tasks} tasks)
                      </button>
                    ) : proposal.status === 'error' && proposal.stories.some((s) => s.issueNumber) ? (
                      <button
                        type="button"
                        className="btn btn--accent"
                        disabled={busy}
                        onClick={() => materialize(selectedItem)}
                      >
                        Retomar criação ({totals?.created}/
                        {(totals?.stories ?? 0) + (totals?.tasks ?? 0)})
                      </button>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
