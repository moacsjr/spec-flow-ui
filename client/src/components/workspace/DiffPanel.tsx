// Painel de diff entre duas versões de um arquivo markdown (unificado / lado a
// lado, modo persistido). Compartilhado pelas telas Specification (PM) e
// revisão técnica do TL. O diff é computado client-side (lib/diffLines) a
// partir dos blobs fornecidos por `blobFor`.

import { useEffect, useState } from 'react';
import { diffLines, toSideBySide } from '../../lib/diffLines';

const DIFF_MODE_KEY = 'spec-flow.spec-diff-mode';

export function DiffPanel({
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

