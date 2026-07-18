// Specification do PM (spec "Tela de Specification"): revisar, refinar e
// aprovar specs geradas por IA. O PM não redige — edita com intenção: lê, pede
// refinamentos em linguagem natural (globais ou sobre um trecho selecionado) e
// aprova atribuindo o milestone no mesmo ato. Features devolvidas pelo Tech
// Leader (label spec:changes-requested) voltam para cá com destaque e triagem
// de comentários.
//
// Decisões de implementação (adaptação à infra existente):
// - O job de refino NÃO commita; o commit acontece no save. Cada refino
//   concluído = refine job → save = UM commit (histórico git é o de versões).
// - Refino ancorado: o trecho selecionado é extraído do markdown-fonte, o job
//   refina SÓ o trecho e o resultado é recosturado (splice) — o restante do
//   documento é preservado byte a byte. Se o arquivo mudou entre a seleção e o
//   envio e o trecho não for re-localizável, degrada para refino global
//   citando o trecho (ANCHOR_STALE).
// - "Aplicar revisões aceitas": instruções aplicadas sequencialmente no client
//   (uma por vez sobre o documento) e UM único save/commit ao final; falha em
//   instrução intermediária aborta sem commit parcial.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { Mdx } from '../../Mdx';
import { hrefForItem, hrefForWorkspace } from '../../../lib/router';
import { isFeature, isOpen, waitingSince } from '../../../lib/workspaceSelectors';
import { diffLines, toSideBySide } from '../../../lib/diffLines';
import { refineArtifact, saveArtifact, createArtifact } from '../../../data/workItem';
import {
  approveSpec,
  fetchReviewComments,
  fetchSpecBlob,
  fetchSpecMeta,
  fetchSpecStatus,
  replyReviewComment,
  returnToPrioritization,
  setReviewTriage,
  type ReviewComment,
  type SpecMeta,
  type SpecStatus,
} from '../../../data/workspace';

const CHANGES_REQUESTED_LABEL = 'spec:changes-requested';
const POLL_MS = 10_000;
const TOC_MIN_H2 = 6;
const DIFF_MODE_KEY = 'spec-flow.spec-diff-mode';

type Substate = 'returned' | 'waiting' | 'generating' | 'error';

interface Anchor {
  text: string;
  startLine: number | null; // null = trecho não localizado no fonte (modo citação)
  endLine: number | null;
  headingPath: string[];
  sha: string | null; // versão sobre a qual a seleção foi feita
}

// ---------- helpers puros ----------

function stripFences(s: string): string {
  const t = s.trim();
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return m ? m[1] : t;
}

// Localiza o trecho no markdown-fonte → linhas + cadeia de headings.
function resolveAnchor(source: string, text: string, sha: string | null): Anchor {
  const idx = source.indexOf(text);
  if (idx === -1) return { text, startLine: null, endLine: null, headingPath: [], sha };
  const before = source.slice(0, idx);
  const startLine = before.split('\n').length;
  const endLine = startLine + text.split('\n').length - 1;
  const headingPath: string[] = [];
  for (const line of before.split('\n').reverse()) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      headingPath.unshift(m[2].trim());
      if (m[1].length === 1) break; // chegou ao topo da cadeia
    }
  }
  return { text, startLine, endLine, headingPath, sha };
}

// Prompt de guarda para refino de trecho isolado: o job recebe SÓ o trecho.
function segmentPrompt(userPrompt: string, headingPath: string[]): string {
  return [
    'Você está editando APENAS um trecho de um documento de especificação maior.',
    headingPath.length ? `O trecho está sob a seção: ${headingPath.join(' → ')}.` : '',
    'Devolva SOMENTE o trecho revisado, sem cercas de código e sem comentários extras.',
    'Não acrescente cabeçalhos nem conteúdo fora do escopo do trecho.',
    '',
    `Ajuste pedido: ${userPrompt}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function hasAcceptanceCriteria(content: string): boolean {
  const m = content.match(/^#{1,4}\s+.*crit[ée]rios? de aceite.*$/im);
  if (!m) return false;
  const after = content.slice((m.index ?? 0) + m[0].length);
  const nextHeading = after.search(/^#{1,4}\s+/m);
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
  return section.trim().length > 0;
}

function h2Sections(content: string): string[] {
  return [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

// ---------- toasts ----------

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="bl-toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className="bl-toast">
          <span className="bl-toast__msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="btn btn--sm btn--accent"
              onClick={() => {
                onDismiss(t.id);
                t.action?.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="bl-toast__close" onClick={() => onDismiss(t.id)} aria-label="Fechar aviso">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- diff panel ----------

function DiffPanel({
  versions,
  base,
  head,
  blobFor,
  onPick,
  onClose,
}: {
  versions: { sha: string; committedAt: string }[];
  base: string;
  head: string;
  blobFor: (sha: string) => Promise<string>;
  onPick: (base: string, head: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'unified' | 'split'>(() =>
    localStorage.getItem(DIFF_MODE_KEY) === 'split' ? 'split' : 'unified',
  );
  const [pair, setPair] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPair(null);
    Promise.all([blobFor(base), blobFor(head)])
      .then(([a, b]) => {
        if (!cancelled) setPair({ a, b });
      })
      .catch(() => {
        if (!cancelled) setPair({ a: '', b: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [base, head, blobFor]);

  const pickMode = (m: 'unified' | 'split') => {
    setMode(m);
    localStorage.setItem(DIFF_MODE_KEY, m);
  };

  const vIndex = (sha: string) => versions.length - versions.findIndex((v) => v.sha === sha);
  const rows = pair ? diffLines(pair.a, pair.b) : [];
  const split = pair && mode === 'split' ? toSideBySide(rows) : [];

  return (
    <div className="sp-diff">
      <div className="sp-diff__bar">
        <select value={base} onChange={(e) => onPick(e.target.value, head)} aria-label="Versão base">
          {versions.map((v) => (
            <option key={v.sha} value={v.sha}>
              v{vIndex(v.sha)} · {v.sha.slice(0, 7)}
            </option>
          ))}
        </select>
        <span className="sp-diff__arrow">→</span>
        <select value={head} onChange={(e) => onPick(base, e.target.value)} aria-label="Versão nova">
          {versions.map((v) => (
            <option key={v.sha} value={v.sha}>
              v{vIndex(v.sha)} · {v.sha.slice(0, 7)}
            </option>
          ))}
        </select>
        <span className="ws-toolbar__spacer" />
        <div className="mst-seg" role="tablist" aria-label="Modo do diff">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'unified'}
            className={`mst-seg__btn${mode === 'unified' ? ' mst-seg__btn--on' : ''}`}
            onClick={() => pickMode('unified')}
          >
            Unificado
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'split'}
            className={`mst-seg__btn${mode === 'split' ? ' mst-seg__btn--on' : ''}`}
            onClick={() => pickMode('split')}
          >
            Lado a lado
          </button>
        </div>
        <button type="button" className="bl-drawer__close" onClick={onClose} aria-label="Fechar diff">
          ✕
        </button>
      </div>

      {!pair ? (
        <p className="bl-drawer__loading">
          <span className="spinner" aria-hidden="true" /> Carregando versões…
        </p>
      ) : mode === 'unified' ? (
        <pre className="sp-diff__code">
          {rows.map((r, i) => (
            <div key={i} className={`sp-diff__line sp-diff__line--${r.type}`}>
              <span className="sp-diff__sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
              {(r.right ?? r.left)?.text ?? ''}
            </div>
          ))}
        </pre>
      ) : (
        <div className="sp-diff__split">
          <pre className="sp-diff__code">
            {split.map((r, i) => (
              <div key={i} className={`sp-diff__line${r.left?.changed ? ' sp-diff__line--del' : ''}`}>
                {r.left?.text ?? ' '}
              </div>
            ))}
          </pre>
          <pre className="sp-diff__code">
            {split.map((r, i) => (
              <div key={i} className={`sp-diff__line${r.right?.changed ? ' sp-diff__line--add' : ''}`}>
                {r.right?.text ?? ' '}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------- comentário do TL ----------

function CommentCard({
  comment,
  busy,
  onAccept,
  onDismiss,
  onReply,
}: {
  comment: ReviewComment;
  busy: boolean;
  onAccept: (instruction: string) => void;
  onDismiss: (reply: string | null) => void;
  onReply: (body: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'accept' | 'dismiss' | 'reply'>('idle');
  const [text, setText] = useState('');

  const startAccept = () => {
    setMode('accept');
    setText(comment.instruction ?? comment.body);
  };

  const resolved = comment.state === 'applied';
  const stateChip =
    comment.state === 'accepted'
      ? { label: 'Aceito', cls: 'sp-comment__state--accepted' }
      : comment.state === 'dismissed'
        ? { label: 'Descartado', cls: 'sp-comment__state--dismissed' }
        : comment.state === 'applied'
          ? { label: 'Aplicado ✓', cls: 'sp-comment__state--applied' }
          : null;

  return (
    <div className={`sp-comment${resolved ? ' sp-comment--resolved' : ''}`}>
      <div className="sp-comment__head">
        <span className="sp-comment__author">{comment.author}</span>
        <span className="sp-comment__time">{waitingSince(comment.createdAt)}</span>
        {stateChip && <span className={`sp-comment__state ${stateChip.cls}`}>{stateChip.label}</span>}
      </div>
      <p className="sp-comment__body">{comment.body}</p>

      {mode === 'idle' && !resolved && (
        <div className="sp-comment__actions">
          <button type="button" className="btn btn--sm btn--accent" disabled={busy} onClick={startAccept}>
            Aceitar
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => { setMode('dismiss'); setText(''); }}>
            Descartar
          </button>
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => { setMode('reply'); setText(''); }}>
            Responder
          </button>
        </div>
      )}

      {mode === 'accept' && (
        <div className="sp-comment__form">
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Instrução a aplicar (editável)"
          />
          <div className="sp-comment__formactions">
            <button type="button" className="btn btn--sm" onClick={() => setMode('idle')}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--sm btn--accent"
              disabled={busy || !text.trim()}
              onClick={() => {
                onAccept(text.trim());
                setMode('idle');
              }}
            >
              Aceitar revisão
            </button>
          </div>
        </div>
      )}

      {(mode === 'dismiss' || mode === 'reply') && (
        <div className="sp-comment__form">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'dismiss' ? 'Justificativa (opcional, vira réplica na issue)…' : 'Réplica na issue…'}
            aria-label={mode === 'dismiss' ? 'Justificativa do descarte' : 'Réplica'}
          />
          <div className="sp-comment__formactions">
            <button type="button" className="btn btn--sm" onClick={() => setMode('idle')}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--sm btn--accent"
              disabled={busy || (mode === 'reply' && !text.trim())}
              onClick={() => {
                if (mode === 'dismiss') onDismiss(text.trim() || null);
                else onReply(text.trim());
                setMode('idle');
              }}
            >
              {mode === 'dismiss' ? 'Descartar' : 'Responder'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- página ----------

interface SpecificationPageExtraProps {
  /** Placeholder do campo de refino (fase 2: sugerido por IA). */
  refinePlaceholder?: string;
}

export function SpecificationPage({
  repoId,
  snapshot,
  refresh,
  refinePlaceholder = 'Descreva o ajuste em linguagem natural',
}: WorkspacePageProps & SpecificationPageExtraProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [metaBy, setMetaBy] = useState<Map<number, SpecMeta>>(new Map());
  const [statusBy, setStatusBy] = useState<Map<number, SpecStatus>>(new Map());
  const [commentsBy, setCommentsBy] = useState<Map<number, ReviewComment[]>>(new Map());
  const [refining, setRefining] = useState<Set<number>>(new Set());
  const [prompt, setPrompt] = useState('');
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [floatBtn, setFloatBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  const [diff, setDiff] = useState<{ base: string; head: string } | null>(null);
  const [removedLocal, setRemovedLocal] = useState<Set<number>>(new Set());
  const [milestonePick, setMilestonePick] = useState<Record<number, string>>({});
  const [pulse, setPulse] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const docRef = useRef<HTMLDivElement>(null);
  const blobCache = useRef<Map<string, string>>(new Map());

  const addToast = (message: string, action?: ToastItem['action']) => {
    const id = ++toastSeq.current;
    setToasts((ts) => [...ts, { id, message, action }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), action ? 10_000 : 6_000);
  };

  // ---- fila ----
  const queue = useMemo(() => {
    const feats = snapshot.items.filter(
      (i) => isFeature(i) && isOpen(i) && i.stage === 'Spec' && !removedLocal.has(i.number),
    );
    const group = (i: SnapshotItem): number => {
      if (i.labels.includes(CHANGES_REQUESTED_LABEL)) return 0;
      const has = metaBy.get(i.number)?.content != null || statusBy.get(i.number)?.hasSpec;
      return has ? 1 : 2;
    };
    return feats.sort((a, b) => {
      const g = group(a) - group(b);
      if (g !== 0) return g;
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.createdAt < b.createdAt ? -1 : 1;
    });
  }, [snapshot.items, removedLocal, metaBy, statusBy]);

  const returnedCount = queue.filter((i) => i.labels.includes(CHANGES_REQUESTED_LABEL)).length;

  const substateOf = (item: SnapshotItem): Substate => {
    if (refining.has(item.number)) return 'generating';
    if (item.labels.includes(CHANGES_REQUESTED_LABEL)) return 'returned';
    const meta = metaBy.get(item.number);
    const st = statusBy.get(item.number);
    if (meta?.content != null || st?.hasSpec) return 'waiting';
    if (st && !st.hasSpec && st.latestRun?.conclusion === 'failure') return 'error';
    return 'generating';
  };

  // Auto-seleção do primeiro item acionável.
  useEffect(() => {
    if (queue.length === 0) {
      setSelected(null);
      return;
    }
    if (selected == null || !queue.some((i) => i.number === selected)) {
      const actionable = queue.find((i) => substateOf(i) !== 'generating' && substateOf(i) !== 'error');
      setSelected((actionable ?? queue[0]).number);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const selectedItem = selected != null ? queue.find((i) => i.number === selected) ?? null : null;

  // ---- carregamento de meta/status/comentários ----
  const loadMeta = async (n: number): Promise<SpecMeta> => {
    const meta = await fetchSpecMeta(repoId, n);
    setMetaBy((m) => new Map(m).set(n, meta));
    if (meta.sha && meta.content != null) blobCache.current.set(meta.sha, meta.content);
    return meta;
  };

  const loadComments = async (n: number) => {
    const comments = await fetchReviewComments(repoId, n);
    setCommentsBy((m) => new Map(m).set(n, comments));
  };

  useEffect(() => {
    if (selected == null) return;
    if (!metaBy.has(selected)) {
      loadMeta(selected).catch((err: Error) => addToast(`Falha ao carregar a spec: ${err.message}`));
    }
    const item = queue.find((i) => i.number === selected);
    if (item?.labels.includes(CHANGES_REQUESTED_LABEL) && !commentsBy.has(selected)) {
      loadComments(selected).catch(() => undefined);
    }
    setAnchor(null);
    setFloatBtn(null);
    setDiff(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Status inicial + polling (10s) enquanto houver itens sem spec.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const unknown = queue.filter(
        (i) => metaBy.get(i.number)?.content == null && statusBy.get(i.number)?.hasSpec !== true,
      );
      for (const item of unknown) {
        try {
          const st = await fetchSpecStatus(repoId, item.number);
          if (cancelled) return;
          const before = statusBy.get(item.number)?.hasSpec;
          setStatusBy((m) => new Map(m).set(item.number, st));
          if (before === false && st.hasSpec) {
            // Geração concluída: pulse único + recarrega se selecionado.
            setPulse((p) => new Set(p).add(item.number));
            window.setTimeout(
              () =>
                setPulse((p) => {
                  const next = new Set(p);
                  next.delete(item.number);
                  return next;
                }),
              2_500,
            );
            if (selected === item.number) loadMeta(item.number).catch(() => undefined);
          }
        } catch {
          /* status é best-effort */
        }
      }
    };
    tick();
    const timer = window.setInterval(() => {
      const pending = queue.some(
        (i) => metaBy.get(i.number)?.content == null && statusBy.get(i.number)?.hasSpec !== true,
      );
      if (pending) tick();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.map((i) => i.number).join(','), repoId]);

  // ---- seleção de texto (refino ancorado) ----
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

  const fixAnchor = () => {
    if (!floatBtn || selected == null) return;
    const meta = metaBy.get(selected);
    setAnchor(resolveAnchor(meta?.content ?? '', floatBtn.text, meta?.sha ?? null));
    setFloatBtn(null);
    window.getSelection()?.removeAllRanges();
  };

  // ---- refino (global / ancorado) ----
  const markRefining = (n: number, on: boolean) =>
    setRefining((s) => {
      const next = new Set(s);
      if (on) next.add(n);
      else next.delete(n);
      return next;
    });

  const runRefine = async (n: number, userPrompt: string, anc: Anchor | null) => {
    const meta = metaBy.get(n);
    if (!meta?.content) return;
    markRefining(n, true);
    try {
      let newContent: string;
      if (anc && anc.startLine != null && anc.endLine != null) {
        // Refino ancorado: refina SÓ o trecho e recostura (resto intacto).
        const lines = meta.content.split('\n');
        const segment = lines.slice(anc.startLine - 1, anc.endLine).join('\n');
        const refined = stripFences(
          await refineArtifact(repoId, n, 'spec', segmentPrompt(userPrompt, anc.headingPath), segment),
        );
        // Checagem de âncora obsoleta: o arquivo mudou desde a seleção?
        const fresh = await fetchSpecMeta(repoId, n);
        if (fresh.sha !== anc.sha) {
          const target = fresh.content ?? '';
          const idx = target.indexOf(segment);
          if (idx === -1) {
            // ANCHOR_STALE: degrada para refino global citando o trecho.
            markRefining(n, false);
            addToast('O documento mudou e o trecho não foi re-localizado.', {
              label: 'Enviar como refino global citando o trecho',
              run: () =>
                runRefine(n, `${userPrompt}\n\nTrecho referido:\n"""\n${anc.text}\n"""`, null),
            });
            setMetaBy((m) => new Map(m).set(n, fresh));
            return;
          }
          newContent = target.slice(0, idx) + refined + target.slice(idx + segment.length);
        } else {
          newContent = [...lines.slice(0, anc.startLine - 1), ...refined.split('\n'), ...lines.slice(anc.endLine)].join('\n');
        }
      } else {
        const promptText =
          anc && anc.startLine == null
            ? `${userPrompt}\n\nTrecho referido:\n"""\n${anc.text}\n"""`
            : userPrompt;
        newContent = stripFences(await refineArtifact(repoId, n, 'spec', promptText, meta.content));
      }

      const prevSha = meta.sha;
      await saveArtifact(repoId, n, 'spec', newContent);
      const updated = await loadMeta(n);
      setPrompt('');
      setAnchor(null);
      if (prevSha && updated.sha && updated.sha !== prevSha) {
        setDiff({ base: prevSha, head: updated.sha });
      }
      addToast(`Refino aplicado em #${n} — v${updated.versions.length} commitada.`);
    } catch (err) {
      addToast(`Falha no refino de #${n}: ${(err as Error).message}`, {
        label: 'Tentar novamente',
        run: () => runRefine(n, userPrompt, anc),
      });
    } finally {
      markRefining(n, false);
    }
  };

  // ---- aplicar revisões aceitas (um único commit) ----
  const applyAccepted = async (n: number) => {
    const accepted = (commentsBy.get(n) ?? [])
      .filter((c) => c.state === 'accepted')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (accepted.length === 0) return;
    markRefining(n, true);
    try {
      const fresh = await fetchSpecMeta(repoId, n);
      let working = fresh.content ?? '';
      for (const c of accepted) {
        const instruction = c.instruction ?? c.body;
        const anchorText = c.anchor?.selectedText;
        try {
          if (anchorText && working.includes(anchorText)) {
            const refined = stripFences(
              await refineArtifact(repoId, n, 'spec', segmentPrompt(instruction, []), anchorText),
            );
            working = working.replace(anchorText, refined);
          } else {
            working = stripFences(await refineArtifact(repoId, n, 'spec', instruction, working));
          }
        } catch (err) {
          // Aborta sem commit parcial; triagem preservada.
          addToast(
            `Falha na revisão do comentário de ${c.author} (“${instruction.slice(0, 60)}…”): ${(err as Error).message}. Nada foi commitado.`,
          );
          markRefining(n, false);
          return;
        }
      }
      const prevSha = fresh.sha;
      await saveArtifact(repoId, n, 'spec', working);
      for (const c of accepted) {
        await setReviewTriage(repoId, n, c.id, 'applied').catch(() => undefined);
      }
      const updated = await loadMeta(n);
      await loadComments(n).catch(() => undefined);
      if (prevSha && updated.sha && updated.sha !== prevSha) {
        setDiff({ base: prevSha, head: updated.sha });
      }
      addToast(`${accepted.length} revisão(ões) aplicadas em um único commit.`);
    } catch (err) {
      addToast(`Falha ao aplicar revisões: ${(err as Error).message}`);
    } finally {
      markRefining(n, false);
    }
  };

  // ---- triagem ----
  const triage = async (n: number, commentId: number, state: 'accepted' | 'dismissed' | 'pending', instruction?: string) => {
    try {
      await setReviewTriage(repoId, n, commentId, state, instruction);
      await loadComments(n);
    } catch (err) {
      addToast(`Falha na triagem: ${(err as Error).message}`);
    }
  };

  const reply = async (n: number, author: string, body: string) => {
    try {
      await replyReviewComment(repoId, n, `@${author} ${body}`);
      addToast('Réplica registrada na issue.');
    } catch (err) {
      addToast(`Falha ao responder: ${(err as Error).message}`);
    }
  };

  // ---- aprovação / retorno ----
  const doApprove = (item: SnapshotItem) => {
    const n = item.number;
    const meta = metaBy.get(n);
    const pending = (commentsBy.get(n) ?? []).filter((c) => c.state === 'pending').length;
    if (pending > 0 && !confirm(`Há ${pending} comentário(s) sem triagem. Aprovar mesmo assim?`)) return;
    if (meta?.content && !hasAcceptanceCriteria(meta.content)) {
      if (!confirm('A spec não tem critérios de aceite. Aprovar mesmo assim?')) return;
    }
    const pick = milestonePick[n] ?? '';
    const milestoneNumber = pick ? Number(pick) : null;

    setRemovedLocal((s) => new Set(s).add(n));
    addToast(`Spec aprovada · #${n} seguiu para o plano técnico.`);
    approveSpec(repoId, n, milestoneNumber)
      .then(() => refresh())
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(n);
          return next;
        });
        addToast(`Falha ao aprovar #${n}: ${err.message}`);
      });
  };

  const doReturn = (item: SnapshotItem) => {
    const n = item.number;
    if (!confirm('A feature volta à priorização. A spec fica salva no repositório.')) return;
    setRemovedLocal((s) => new Set(s).add(n));
    returnToPrioritization(repoId, n)
      .then(() => refresh())
      .catch((err: Error) => {
        setRemovedLocal((s) => {
          const next = new Set(s);
          next.delete(n);
          return next;
        });
        addToast(`Falha ao devolver #${n}: ${err.message}`);
      });
  };

  const reRun = (item: SnapshotItem) => {
    createArtifact(repoId, item.number, 'spec')
      .then(() => addToast(`Geração da spec de #${item.number} re-disparada.`))
      .catch((err: Error) => addToast(`Falha ao reexecutar: ${err.message}`));
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
  const comments = selected != null ? commentsBy.get(selected) ?? [] : [];
  const acceptedCount = comments.filter((c) => c.state === 'accepted').length;
  const isRefining = selected != null && refining.has(selected);
  const selectedSub = selectedItem ? substateOf(selectedItem) : null;
  const sections = meta?.content ? h2Sections(meta.content) : [];
  const openMilestones = snapshot.milestones.filter((m) => m.state === 'open');

  const scrollToSection = (index: number) => {
    const headings = docRef.current?.querySelectorAll('h2');
    headings?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="ws-page">
      <div className="bl-head">
        <span className="bl-head__count">
          {queue.length} spec{queue.length === 1 ? '' : 's'} na fila
        </span>
        {returnedCount > 0 && (
          <span className="sp-returned-badge">{returnedCount} devolvida(s)</span>
        )}
      </div>

      {queue.length === 0 ? (
        <div className="bl-empty">
          <span className="bl-empty__icon">📄</span>
          <p>Nenhuma spec na fila.</p>
          <div className="bl-empty__actions">
            <a className="btn btn--sm" href={hrefForWorkspace('pm', 'prioritization')}>
              Ir para a Prioritization
            </a>
          </div>
        </div>
      ) : (
        <div className="sp-split">
          {/* Fila */}
          <aside className="sp-queue">
            {queue.map((item) => {
              const sub = substateOf(item);
              const st = statusBy.get(item.number);
              const v = metaBy.get(item.number)?.versions.length;
              const nComments = (commentsBy.get(item.number) ?? []).length;
              return (
                <button
                  key={item.number}
                  type="button"
                  className={[
                    'sp-queue__item',
                    `sp-queue__item--${sub}`,
                    selected === item.number ? 'sp-queue__item--selected' : '',
                    pulse.has(item.number) ? 'sp-queue__item--pulse' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setSelected(item.number)}
                >
                  <span className="sp-queue__title">
                    <span className="mono">#{item.number}</span> {item.title}
                  </span>
                  <span className="sp-queue__status">
                    {sub === 'returned' &&
                      `Devolvida${nComments ? ` · ${nComments} comentário(s)` : ''}`}
                    {sub === 'waiting' && `Aguardando revisão${v ? ` · v${v}` : ''}`}
                    {sub === 'generating' && (
                      <>
                        <span className="spinner" aria-hidden="true" />{' '}
                        {refining.has(item.number) ? 'Refinando…' : 'Gerando spec…'}
                      </>
                    )}
                    {sub === 'error' && (
                      <>
                        ⚠️ Falha na geração
                        {st?.latestRun?.url ? '' : ''}
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Painel do documento */}
          <section className="sp-doc">
            {!selectedItem ? null : selectedSub === 'generating' && !meta?.content ? (
              <p className="bl-drawer__loading">
                <span className="spinner" aria-hidden="true" /> Gerando spec — o documento aparece
                aqui quando a Action concluir.
              </p>
            ) : selectedSub === 'error' && !meta?.content ? (
              <div className="bl-empty">
                <span className="bl-empty__icon">⚠️</span>
                <p>
                  A geração da spec falhou.
                  {statusBy.get(selectedItem.number)?.latestRun?.url && (
                    <>
                      {' '}
                      <a
                        href={statusBy.get(selectedItem.number)!.latestRun!.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver execução
                      </a>
                    </>
                  )}
                </p>
                <div className="bl-empty__actions">
                  <button type="button" className="btn btn--sm btn--accent" onClick={() => reRun(selectedItem)}>
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
                {/* Header do documento */}
                <div className="sp-doc__head">
                  <span className="sp-doc__title">
                    <span className="mono">#{selectedItem.number}</span> {selectedItem.title}
                  </span>
                  <span className="sp-doc__meta">
                    spec.md · v{meta.versions.length}
                    {meta.versions[0] && ` · commitada ${waitingSince(meta.versions[0].committedAt)}`}
                  </span>
                  <span className="ws-toolbar__spacer" />
                  {meta.versions.length >= 2 && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() =>
                        setDiff((d) =>
                          d ? null : { base: meta.versions[1].sha, head: meta.versions[0].sha },
                        )
                      }
                    >
                      v{meta.versions.length - 1} → v{meta.versions.length}
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

                {/* Diff */}
                {diff && meta.versions.length >= 2 && (
                  <DiffPanel
                    versions={meta.versions}
                    base={diff.base}
                    head={diff.head}
                    blobFor={blobFor}
                    onPick={(base, head) => setDiff({ base, head })}
                    onClose={() => setDiff(null)}
                  />
                )}

                {/* Comentários do TL (devolvida) */}
                {selectedSub === 'returned' && (
                  <div className="sp-comments">
                    <div className="sp-comments__head">Comentários do Tech Leader</div>
                    {comments.length === 0 ? (
                      <p className="bl-drawer__loading">Carregando comentários…</p>
                    ) : (
                      comments.map((c) => (
                        <CommentCard
                          key={c.id}
                          comment={c}
                          busy={isRefining}
                          onAccept={(instruction) =>
                            triage(selectedItem.number, c.id, 'accepted', instruction)
                          }
                          onDismiss={(replyText) => {
                            triage(selectedItem.number, c.id, 'dismissed');
                            if (replyText) reply(selectedItem.number, c.author, replyText);
                          }}
                          onReply={(body) => reply(selectedItem.number, c.author, body)}
                        />
                      ))
                    )}
                  </div>
                )}

                {/* Sumário */}
                {sections.length >= TOC_MIN_H2 && (
                  <nav className="sp-toc" aria-label="Sumário">
                    {sections.map((s, i) => (
                      <button key={i} type="button" className="sp-toc__link" onClick={() => scrollToSection(i)}>
                        {s}
                      </button>
                    ))}
                  </nav>
                )}

                {/* Documento */}
                <div
                  ref={docRef}
                  className={`sp-doc__body${isRefining ? ' sp-doc__body--locked' : ''}`}
                  onMouseUp={onDocMouseUp}
                >
                  {meta.content ? <Mdx source={meta.content} /> : <p>Sem conteúdo.</p>}
                  {floatBtn && !isRefining && (
                    <button
                      type="button"
                      className="sp-floatbtn"
                      style={{ left: floatBtn.x, top: floatBtn.y - 34 }}
                      onClick={fixAnchor}
                    >
                      ✂️ Refinar trecho
                    </button>
                  )}
                  {isRefining && (
                    <div className="sp-doc__lock" role="status">
                      <span className="spinner" aria-hidden="true" /> Refinando — o documento está
                      em modo somente leitura.
                    </div>
                  )}
                </div>

                {/* Área de aplicação (devolvida) */}
                {selectedSub === 'returned' && acceptedCount > 0 && (
                  <div className="sp-applybar">
                    <span>
                      {acceptedCount} revis{acceptedCount === 1 ? 'ão aceita' : 'ões aceitas'}
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm btn--accent"
                      disabled={isRefining}
                      onClick={() => applyAccepted(selectedItem.number)}
                    >
                      Aplicar revisões aceitas
                    </button>
                  </div>
                )}

                {/* Campo de refino */}
                <div className="sp-refine">
                  {anchor && (
                    <div className="sp-refine__chip">
                      ✂️ “{anchor.text.slice(0, 60)}
                      {anchor.text.length > 60 ? '…' : ''}”
                      {anchor.startLine == null && ' (trecho não localizado — será citado)'}
                      <button
                        type="button"
                        className="bl-pane__clear"
                        onClick={() => setAnchor(null)}
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
                      disabled={isRefining || !meta.content}
                      placeholder={anchor ? 'O que mudar neste trecho?' : refinePlaceholder}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && prompt.trim() && !isRefining) {
                          runRefine(selectedItem.number, prompt.trim(), anchor);
                        }
                      }}
                      aria-label="Pedido de refino"
                    />
                    <button
                      type="button"
                      className="btn btn--sm btn--accent"
                      disabled={isRefining || !prompt.trim() || !meta.content}
                      onClick={() => runRefine(selectedItem.number, prompt.trim(), anchor)}
                    >
                      {isRefining ? (
                        <>
                          <span className="spinner" aria-hidden="true" /> Refinando…
                        </>
                      ) : (
                        'Refinar'
                      )}
                    </button>
                  </div>
                </div>

                {/* Rodapé de ações */}
                <div className="sp-actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={isRefining}
                    onClick={() => doReturn(selectedItem)}
                  >
                    Voltar à priorização
                  </button>
                  <span className="ws-toolbar__spacer" />
                  <label className="bl-bulkbar__label">
                    Milestone
                    <select
                      className="queue__priosel"
                      value={milestonePick[selectedItem.number] ?? ''}
                      onChange={(e) =>
                        setMilestonePick((m) => ({ ...m, [selectedItem.number]: e.target.value }))
                      }
                      aria-label="Milestone da aprovação"
                    >
                      <option value="">Sem milestone</option>
                      {openMilestones.map((m) => (
                        <option key={m.number} value={m.number}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn btn--accent"
                    disabled={isRefining || !meta.content}
                    onClick={() => doApprove(selectedItem)}
                  >
                    Aprovar spec
                  </button>
                </div>

                <div className="sp-doc__footlinks">
                  <a href={hrefForItem(repoId, 'feature', selectedItem.number)}>Abrir a Feature completa →</a>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((ts) => ts.filter((t) => t.id !== id))} />
    </div>
  );
}
