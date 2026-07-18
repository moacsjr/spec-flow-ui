// Homologação do PM (spec "Homologação e Dashboard" parte 1): validação de
// VALOR DE NEGÓCIO — o último portão humano antes de Done. A fila é só de
// Stories (Bugs são roteados a Done pelo QA); agrupada por milestone (ETA asc),
// mais antiga na etapa primeiro (a fila envelhecendo é gargalo do próprio PM).
// Approve → Done + verificação D4 (fechamento automático da Feature completa);
// Return → Development com marcador uat-return e bug opcional (regra D5).

import { useEffect, useMemo, useState } from 'react';
import type { MilestoneSummary, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { Mdx } from '../../Mdx';
import { ToastStack, useToasts } from '../Toasts';
import { hrefForWorkspace } from '../../../lib/router';
import { isOpen } from '../../../lib/workspaceSelectors';
import { fetchWorkItem } from '../../../data/workItem';
import {
  fetchSpecSection,
  uatApprove,
  uatReturn,
  type SpecSection,
} from '../../../data/workspace';
import {
  TimeCell,
  TypeBadgeExec,
  featureOf,
  itemsByNumber,
  useStageAges,
} from '../tech/executionShared';
import { typeSlug } from '../../../lib/workItemType';

const WARN_DAYS = 5;

const isDoneItem = (i: SnapshotItem): boolean => i.state === 'closed' || i.stage === 'Done';

// A aprovação desta Story completa 100% da Feature-pai? (badge "última da
// feature" — o Approve fecha uma entrega inteira via D4)
function completesFeature(story: SnapshotItem, items: SnapshotItem[]): boolean {
  const featureNumber = story.parentNumber;
  if (featureNumber == null) return false;
  const stories = items.filter(
    (i) => i.parentNumber === featureNumber && typeSlug(i) === 'story',
  );
  if (stories.length === 0) return false;
  if (!stories.every((s) => s.number === story.number || isDoneItem(s))) return false;
  const storyNumbers = new Set(stories.map((s) => s.number));
  const bugs = items.filter(
    (i) =>
      typeSlug(i) === 'bug' &&
      i.parentNumber != null &&
      (i.parentNumber === featureNumber || storyNumbers.has(i.parentNumber)),
  );
  return bugs.every(isDoneItem);
}

interface UatGroup {
  key: string;
  title: string | null;
  items: SnapshotItem[];
}

export function HomologationPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const [storyBody, setStoryBody] = useState<Map<number, string>>(new Map());
  const [sections, setSections] = useState<Map<number, SpecSection>>(new Map());
  const [returnModal, setReturnModal] = useState<SnapshotItem | null>(null);
  const [reason, setReason] = useState('');
  const [createBug, setCreateBug] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const ages = useStageAges(repoId, 'UAT', snapshot.generatedAt);

  const queue = useMemo(
    () =>
      snapshot.items.filter(
        (i) => typeSlug(i) === 'story' && isOpen(i) && i.stage === 'UAT' && !removedLocal.has(i.number),
      ),
    [snapshot.items, removedLocal],
  );

  // Grupos por milestone (ETA asc, "Sem milestone" ao final); dentro do grupo,
  // mais antiga na etapa primeiro.
  const groups = useMemo((): UatGroup[] => {
    const ageOf = (i: SnapshotItem) => ages.get(i.number)?.at ?? i.createdAt;
    const sortItems = (list: SnapshotItem[]) =>
      [...list].sort((a, b) => (ageOf(a) < ageOf(b) ? -1 : 1));
    const open = snapshot.milestones
      .filter((m: MilestoneSummary) => m.state === 'open')
      .sort((a, b) => ((a.dueOn ?? '9999') < (b.dueOn ?? '9999') ? -1 : 1));
    const out: UatGroup[] = [];
    for (const m of open) {
      const list = queue.filter((i) => i.milestone?.number === m.number);
      if (list.length) out.push({ key: `m${m.number}`, title: m.title, items: sortItems(list) });
    }
    const none = queue.filter(
      (i) => !i.milestone || !open.some((m) => m.number === i.milestone?.number),
    );
    if (none.length) out.push({ key: 'none', title: null, items: sortItems(none) });
    return out;
  }, [queue, snapshot.milestones, ages]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const selectedItem = selected != null ? flat.find((i) => i.number === selected) ?? null : null;

  // Auto-seleção do primeiro (mais urgente) quando a seleção some da fila.
  useEffect(() => {
    if (flat.length === 0) {
      setSelected(null);
      return;
    }
    if (selected == null || !flat.some((i) => i.number === selected)) {
      setSelected(flat[0].number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  // Painel: corpo da user story + seção de critérios da spec da Feature.
  useEffect(() => {
    if (!selectedItem) return;
    const n = selectedItem.number;
    if (!storyBody.has(n)) {
      fetchWorkItem(repoId, 'story', n)
        .then((view) => setStoryBody((m) => new Map(m).set(n, view.descriptionMdx)))
        .catch(() => setStoryBody((m) => new Map(m).set(n, '')));
    }
    const featureNumber = selectedItem.parentNumber;
    if (featureNumber != null && !sections.has(featureNumber)) {
      fetchSpecSection(repoId, featureNumber, 'critério')
        .then((s) => setSections((m) => new Map(m).set(featureNumber, s)))
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem, repoId]);

  const doApprove = (item: SnapshotItem) => {
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(item.number));
    uatApprove(repoId, item.number)
      .then((r) => {
        if (r.featureClosed && r.featureNumber != null) {
          addToast(`Story aprovada · Feature #${r.featureNumber} concluída 🎉`);
        } else if (r.pendingCheck) {
          addToast('Story aprovada · fechamento da feature pendente (reverificado em breve).');
        } else {
          addToast(`Story #${item.number} aprovada.`);
        }
        refresh();
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha ao aprovar #${item.number}: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => doApprove(item),
        });
      })
      .finally(() => setBusy(false));
  };

  const doReturn = () => {
    const item = returnModal;
    if (!item || reason.trim().length < 10) return;
    setBusy(true);
    uatReturn(repoId, item.number, reason.trim(), createBug)
      .then((r) => {
        setReturnModal(null);
        setReason('');
        setCreateBug(false);
        setRemovedLocal((s) => new Set(s).add(item.number));
        addToast(
          r.bugNumber != null
            ? `#${item.number} devolvida ao desenvolvimento · Bug #${r.bugNumber} criado.`
            : `#${item.number} devolvida ao desenvolvimento.`,
        );
        refresh();
      })
      .catch((err: Error) => addToast(`Falha ao devolver: ${err.message}`))
      .finally(() => setBusy(false));
  };

  const section =
    selectedItem?.parentNumber != null ? sections.get(selectedItem.parentNumber) : undefined;
  const feature = selectedItem ? featureOf(selectedItem, byNumber) : null;
  const tasks = selectedItem
    ? snapshot.items
        .filter((t) => t.parentNumber === selectedItem.number && t.level === 'task')
        .sort((a, b) => a.number - b.number)
    : [];
  const mergedPrs = selectedItem ? selectedItem.prs.filter((p) => p.state === 'merged') : [];

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">
          {queue.length} {queue.length === 1 ? 'story aguardando' : 'stories aguardando'} seu aceite
        </span>
      </div>

      {queue.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">✅</span>
          <p>Nada aguardando seu aceite.</p>
          <p className="tl-empty__hint">As stories chegam aqui pelo veredito de QA do Tech Leader.</p>
        </div>
      ) : (
        <div className="ut-split">
          {/* Fila */}
          <aside className="sp-queue">
            {groups.map((g) => (
              <div key={g.key} className="ut-group">
                <div className="ut-group__title">{g.title ?? 'Sem milestone'}</div>
                {g.items.map((item) => {
                  const last = completesFeature(item, snapshot.items);
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
                      <span className="ut-row-meta">
                        <span className="ut-row-meta__feature" title={featureOf(item, byNumber)?.title}>
                          {featureOf(item, byNumber)?.title ?? '—'}
                        </span>
                        <span className="mono">{item.points != null ? `${item.points}pts` : '—'}</span>
                        <TimeCell age={ages.get(item.number)} warnDays={WARN_DAYS} />
                        {last && <span className="ut-last-chip">última da feature</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

          {/* Painel de validação */}
          {selectedItem ? (
            <section className="ut-panel">
              <header className="ut-panel__head">
                <TypeBadgeExec item={selectedItem} />
                <h3 className="ut-panel__title">
                  <span className="mono">#{selectedItem.number}</span> {selectedItem.title}
                </h3>
                <a
                  className="btn btn--sm"
                  href={selectedItem.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub ↗
                </a>
              </header>

              <div className="ut-panel__body">
                <h4 className="ut-section__title">User story</h4>
                <div className="ut-doc">
                  {storyBody.has(selectedItem.number) ? (
                    storyBody.get(selectedItem.number) ? (
                      <Mdx source={storyBody.get(selectedItem.number) as string} />
                    ) : (
                      <p className="pl2-dim">Sem descrição na issue.</p>
                    )
                  ) : (
                    <p className="pl2-dim">Carregando…</p>
                  )}
                </div>

                <h4 className="ut-section__title">
                  Critérios de aceite da Feature
                  {feature && selectedItem.parentNumber != null && (
                    <a
                      className="ut-section__link"
                      href={hrefForWorkspace('pm', 'specification', {
                        feature: selectedItem.parentNumber,
                      })}
                    >
                      spec completa →
                    </a>
                  )}
                </h4>
                <div className="ut-doc">
                  {section === undefined ? (
                    <p className="pl2-dim">Carregando…</p>
                  ) : section.content ? (
                    <Mdx source={section.content} />
                  ) : (
                    <p className="ut-warn">
                      {section.hasSpec
                        ? '⚠️ Spec sem seção de critérios de aceite.'
                        : '⚠️ A Feature ainda não tem spec.md.'}
                    </p>
                  )}
                </div>

                <h4 className="ut-section__title">Evidência de entrega</h4>
                <div className="ut-evidence">
                  {tasks.length > 0 ? (
                    <ul className="dv-tasklist">
                      {tasks.map((t) => (
                        <li key={t.number}>
                          <span
                            className={
                              t.state === 'closed' ? 'dv-task dv-task--done' : 'dv-task ut-task--open'
                            }
                          >
                            {t.state === 'closed' ? '✓' : '⚠️ aberta —'}{' '}
                            <span className="mono">#{t.number}</span> {t.title}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pl2-dim">Story sem tasks.</p>
                  )}
                  <div className="ex-row__prs">
                    {mergedPrs.length > 0 ? (
                      mergedPrs.map((pr) => (
                        <a
                          key={pr.number}
                          className="prchip prchip--merged"
                          href={pr.url}
                          target="_blank"
                          rel="noreferrer"
                          title={pr.title}
                        >
                          PR #{pr.number} merged
                        </a>
                      ))
                    ) : (
                      <span className="pl2-dim">sem PR merged vinculado</span>
                    )}
                  </div>
                </div>
              </div>

              <footer className="ut-panel__foot">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={() => setReturnModal(selectedItem)}
                >
                  Return to Development
                </button>
                <span className="ws-toolbar__spacer" />
                {completesFeature(selectedItem, snapshot.items) && (
                  <span className="ut-last-chip">este approve conclui a feature</span>
                )}
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={busy}
                  onClick={() => doApprove(selectedItem)}
                >
                  Approve
                </button>
              </footer>
            </section>
          ) : (
            <section className="ut-panel">
              <p className="pl2-dim">Selecione uma story na fila.</p>
            </section>
          )}
        </div>
      )}

      {/* Modal de devolução (espelha o veredito do QA; marcador uat-return) */}
      {returnModal && (
        <div className="mst-modal-backdrop" onMouseDown={() => !busy && setReturnModal(null)}>
          <div className="mst-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mst-modal__head">
              <h3>Devolver #{returnModal.number} ao desenvolvimento</h3>
            </div>
            <div className="mst-modal__body">
              <label className="mst-field">
                <span>Motivo (obrigatório, mínimo 10 caracteres)</span>
                <textarea
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="O que impede o aceite de negócio?"
                  autoFocus
                />
              </label>
              <label className="dv-toggle">
                <input
                  type="checkbox"
                  checked={createBug}
                  onChange={(e) => setCreateBug(e.target.checked)}
                />{' '}
                Registrar como bug (issue [BUG] vinculada à story, mesma release, etapa Ready)
              </label>
            </div>
            <div className="mst-modal__foot">
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setReturnModal(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                disabled={busy || reason.trim().length < 10}
                onClick={doReturn}
              >
                {busy ? 'Devolvendo…' : 'Devolver'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
