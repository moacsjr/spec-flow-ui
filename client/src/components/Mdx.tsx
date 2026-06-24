import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Mapa de elementos MDX → componentes estilizados (RFC seção 4.4).
// Não confiamos em CSS de tags cru: cada elemento relevante é estilizado por
// componente, conforme a spec.

function InfoIcon() {
  return (
    <svg
      className="callout__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const components: Components = {
  // Callout / nota — blockquote vira painel com borda-esquerda accent e ícone.
  blockquote({ children }: any) {
    return (
      <blockquote>
        <InfoIcon />
        <div>{children}</div>
      </blockquote>
    );
  },

  // Item de lista: checklist (task-list-item) ou marcador "›".
  li({ children, className }: any) {
    const isTask = typeof className === 'string' && className.includes('task-list-item');
    if (isTask) {
      return <li className="task">{children}</li>;
    }
    return <li>{children}</li>;
  },

  // Checkbox de critério de aceite — visual 18px, marcado/vazio (RFC seção 4.4).
  input({ checked, type }: any) {
    if (type !== 'checkbox') return null;
    return (
      <span
        className={`checkbox${checked ? ' checkbox--done' : ''}`}
        role="checkbox"
        aria-checked={!!checked}
      >
        {checked ? '✓' : ''}
      </span>
    );
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

interface MdxProps {
  source: string;
}

export function Mdx({ source }: MdxProps) {
  return (
    <div className="mdx">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
