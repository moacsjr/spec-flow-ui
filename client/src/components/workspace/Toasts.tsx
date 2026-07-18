// Toasts do workspace (stack fixa no canto inferior direito, ação opcional de
// retry, auto-dismiss). Compartilhado pelas telas do PM (Backlog, Specification,
// Prioritization). Uso: const { toasts, addToast, dismissToast } = useToasts();
// e <ToastStack toasts={toasts} onDismiss={dismissToast} /> no fim da página.

import { useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const addToast = (message: string, action?: ToastItem['action']) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts, { id, message, action }]);
    window.setTimeout(
      () => setToasts((ts) => ts.filter((t) => t.id !== id)),
      action ? 10_000 : 6_000,
    );
  };

  const dismissToast = (id: number) => setToasts((ts) => ts.filter((t) => t.id !== id));

  return { toasts, addToast, dismissToast };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
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
          <button
            type="button"
            className="bl-toast__close"
            onClick={() => onDismiss(t.id)}
            aria-label="Fechar aviso"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
