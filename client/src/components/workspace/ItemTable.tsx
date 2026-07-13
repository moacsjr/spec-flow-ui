// Tabela genérica de SnapshotItems para as filas do PM (Backlog, Prioritization).
// Reaproveita o estilo `.proj-table` do ProjectPage. Cada coluna define seu
// cabeçalho e como renderizar a célula; ações (icon buttons, selects) entram
// como uma coluna com `cell` próprio.

import type { ReactNode } from 'react';
import type { SnapshotItem } from '@spec-flow/shared';

export interface Column {
  /** rótulo do cabeçalho; também serve de chave da coluna (deve ser único). */
  header: string;
  cell: (item: SnapshotItem) => ReactNode;
  /** conteúdo customizado do `<th>` (ex.: checkbox de selecionar todas); usa `header` só como chave. */
  headerCell?: ReactNode;
  /** classe aplicada ao `<td>` (e ao `<th>` se `headerClassName` não vier). */
  className?: string;
  headerClassName?: string;
}

interface ItemTableProps {
  items: SnapshotItem[];
  columns: Column[];
  empty: string;
}

export function ItemTable({ items, columns, empty }: ItemTableProps) {
  if (items.length === 0) {
    return <p className="queue__empty">{empty}</p>;
  }

  return (
    <div className="proj-table-wrap">
      <table className="proj-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.headerClassName ?? c.className}>
                {c.headerCell ?? c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.number}>
              {columns.map((c) => (
                <td key={c.header} className={c.className}>
                  {c.cell(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
