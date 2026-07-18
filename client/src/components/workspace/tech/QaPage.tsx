// QA do TL (spec "Telas de execução" §3.4): etapa 🧪 QA — a única tela de
// execução com veredito. Approve roteia por tipo (Story → 📋 Homologação;
// Bug → 🎉 Done direto — correção técnica não tem validação de negócio).
// Return exige motivo (≥10 chars, postado com <!-- qa-return -->) e pode
// registrar um Bug vinculado no mesmo ato (regra D5).

import { useMemo, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { isOpen } from '../../../lib/workspaceSelectors';
import { typeSlug } from '../../../lib/workItemType';
import { qaApprove, qaReturn } from '../../../data/workspace';
import {
  AssigneeCell,
  ExecGroups,
  TimeCell,
  TypeBadgeExec,
  daysFrom,
  featureOf,
  groupByMilestoneEta,
  isExecItem,
  itemsByNumber,
  useGroupCollapse,
  useStageAges,
} from './executionShared';

const WARN_DAYS = 3;
const MIN_REASON = 10;

export function TechQaPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const items = useMemo(
    () =>
      snapshot.items.filter(
        (i) => isExecItem(i) && isOpen(i) && i.stage === 'QA' && !removedLocal.has(i.number),
      ),
    [snapshot.items, removedLocal],
  );
  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);
  const ages = useStageAges(repoId, 'QA', snapshot.generatedAt);
  const { collapsed, toggle } = useGroupCollapse(repoId, 'qa');
  const [drawer, setDrawer] = useState<SnapshotItem | null>(null);
  const [returning, setReturning] = useState<SnapshotItem | null>(null);
  const [reason, setReason] = useState('');
  const [createBug, setCreateBug] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toasts, addToast, dismissToast } = useToasts();

  const groups = useMemo(
    () => groupByMilestoneEta(items, snapshot.milestones.filter((m) => m.state === 'open')),
    [items, snapshot.milestones],
  );

  const aged = items.filter((i) => {
    const a = ages.get(i.number);
    return a && daysFrom(a.at) > WARN_DAYS;
  }).length;

  const doApprove = (item: SnapshotItem) => {
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(item.number));
    qaApprove(repoId, 'story', item.number)
      .then((res) => {
        addToast(
          res.movedTo === 'Done'
            ? `Bug #${item.number} aprovado — direto para Done.`
            : `#${item.number} aprovada — seguiu para a Homologação.`,
        );
        refresh();
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha no approve: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => doApprove(item),
        });
      })
      .finally(() => setBusy(false));
  };

  const doReturn = () => {
    if (!returning || reason.trim().length < MIN_REASON) return;
    const item = returning;
    setBusy(true);
    setRemovedLocal((s) => new Set(s).add(item.number));
    setReturning(null);
    qaReturn(repoId, 'story', item.number, reason.trim(), createBug)
      .then((res) => {
        addToast(
          res.bugNumber
            ? `#${item.number} devolvida ao desenvolvimento; bug #${res.bugNumber} registrado em Ready.`
            : `#${item.number} devolvida ao desenvolvimento.`,
        );
        setReason('');
        setCreateBug(false);
        refresh();
      })
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(item.number);
          return next;
        });
        addToast(`Falha no retorno: ${err.message}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">{items.length} itens em QA</span>
      </div>

      {aged > 0 && (
        <div className="bl-insights">
          💡 {aged} {aged === 1 ? 'item' : 'itens'} em QA há mais de {WARN_DAYS} dias.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">🧪</span>
          <p>Nada em QA.</p>
          <p className="tl-empty__hint">Os itens chegam aqui do Code Review.</p>
        </div>
      ) : (
        <ExecGroups
          groups={groups}
          collapsed={collapsed}
          onToggle={toggle}
          renderRow={(item) => {
            const feature = featureOf(item, byNumber);
            const isBug = typeSlug(item) === 'bug';
            return (
              <div key={item.number} className="ex-row">
                <span className="ex-row__lead" />
                <TypeBadgeExec item={item} />
                <button type="button" className="ex-row__title" onClick={() => setDrawer(item)} title={item.title}>
                  <span className="mono">#{item.number}</span> {item.title}
                </button>
                <button
                  type="button"
                  className="ex-row__feature"
                  onClick={() => feature && setDrawer(feature)}
                  title={feature?.title}
                >
                  {feature?.title ?? '—'}
                </button>
                <span className="mono">{item.points != null ? `${item.points} pts` : '—'}</span>
                <AssigneeCell item={item} />
                <TimeCell age={ages.get(item.number)} warnDays={WARN_DAYS} />
                <span className="ex-row__actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--accent"
                    disabled={busy}
                    title={
                      isBug
                        ? 'Bug aprovado vai direto para Done (correção técnica não tem validação de negócio)'
                        : 'Story aprovada segue para a Homologação (aceite de valor do PM)'
                    }
                    onClick={() => doApprove(item)}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={busy}
                    onClick={() => {
                      setReturning(item);
                      setReason('');
                      setCreateBug(false);
                    }}
                  >
                    Return
                  </button>
                </span>
              </div>
            );
          }}
        />
      )}

      {/* Modal de retorno ao desenvolvimento */}
      {returning && (
        <div className="mst-modal-backdrop" onMouseDown={() => setReturning(null)}>
          <div className="mst-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <div className="mst-modal__head">
              <h3>Devolver #{returning.number} ao desenvolvimento</h3>
              <button
                type="button"
                className="mst-drawer__close"
                onClick={() => setReturning(null)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="mst-modal__body">
              <label className="mst-field">
                <span>Motivo (obrigatório, mínimo {MIN_REASON} caracteres)</span>
                <textarea
                  rows={3}
                  value={reason}
                  autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="O que falhou na validação?"
                />
              </label>
              <label className="bl-tree-foot" style={{ border: 'none', margin: 0, padding: 0 }}>
                <input
                  type="checkbox"
                  className="bl-check"
                  checked={createBug}
                  onChange={(e) => setCreateBug(e.target.checked)}
                />
                Registrar como bug (cria issue [BUG] vinculada, milestone herdado, etapa Ready)
              </label>
            </div>
            <div className="mst-modal__foot">
              <button type="button" className="btn btn--sm" onClick={() => setReturning(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                disabled={busy || reason.trim().length < MIN_REASON}
                onClick={doReturn}
              >
                Devolver{createBug ? ' + registrar bug' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && <FeatureDrawer repoId={repoId} item={drawer} onClose={() => setDrawer(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
