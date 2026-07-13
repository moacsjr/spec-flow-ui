// Project do PM: visão completa da estrutura do projeto em dois modos —
// Tabela (flat: id, tipo, título, pai, etapa, status, prioridade) e Árvore
// (hierarquia por parentNumber; itens sem pai ficam em "Itens sem parent").
// A tela também cria um work item de qualquer tipo (POST /workitems).

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { SnapshotItem, WorkItemType } from '@spec-flow/shared';
import { isAllowedParent, PRIORITIES, WORK_ITEM_TYPES } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { createWorkItem } from '../../../data/workItem';
import { reparentWorkItem, reorderWorkItems } from '../../../data/workspace';
import { readCollapsed, writeCollapsed } from '../../../state/projectTreePrefs';
import { asType, typeOf } from '../../../lib/workItemType';
import { TypeBadge } from '../TypeBadge';

const AREAS = ['Frontend', 'Backend', 'Mobile', 'Infra', 'DevOps', 'Data'];

const TYPE_OPTION_LABEL: Record<WorkItemType, string> = {
  initiative: 'Initiative',
  epic: 'Epic',
  feature: 'Feature',
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
  spike: 'Spike',
};

function statusLabel(item: SnapshotItem): string {
  return item.state === 'closed' ? 'Fechado' : 'Aberto';
}

// ---------- Formulário: criar work item de qualquer tipo ----------

function CreateForm({
  items,
  repoId,
  onDone,
  onCancel,
}: {
  items: SnapshotItem[];
  repoId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<WorkItemType>('feature');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('');
  const [area, setArea] = useState('');
  const [parent, setParent] = useState('');
  const [saving, setSaving] = useState(false);

  const parentOptions = useMemo(
    () => [...items].sort((a, b) => a.number - b.number),
    [items],
  );

  const submit = () => {
    if (!title.trim()) return;
    setSaving(true);
    createWorkItem(repoId, {
      type,
      title: title.trim(),
      ...(description.trim() ? { descriptionMdx: description.trim() } : {}),
      ...(priority ? { priority } : {}),
      ...(area ? { area } : {}),
      ...(parent ? { parentNumber: Number(parent) } : {}),
    })
      .then(onDone)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="idea-form">
      <div className="proj-form__row">
        <select value={type} onChange={(e) => setType(e.target.value as WorkItemType)} aria-label="Tipo">
          {WORK_ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_OPTION_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="idea-form__title"
          placeholder="Título…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="proj-form__row">
        <select value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Parent">
          <option value="">Sem parent (raiz)</option>
          {parentOptions.map((i) => (
            <option key={i.number} value={i.number}>
              #{i.number} {typeOf(i)} — {i.title}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Prioridade">
          <option value="">Sem prioridade</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Área">
          <option value="">Sem área</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="idea-form__desc"
        placeholder="Descrição (opcional)…"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="idea-form__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={submit}
          disabled={saving || !title.trim()}
        >
          {saving ? 'Criando…' : 'Criar item'}
        </button>
      </div>
    </div>
  );
}

// ---------- Modo tabela ----------

function TableView({ items }: { items: SnapshotItem[] }) {
  const rows = useMemo(() => [...items].sort((a, b) => a.number - b.number), [items]);
  if (rows.length === 0) return <p className="queue__empty">Nenhum item no projeto.</p>;

  return (
    <div className="proj-table-wrap">
      <table className="proj-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Tipo</th>
            <th>Título</th>
            <th>Pai</th>
            <th>Etapa</th>
            <th>Status</th>
            <th>Prioridade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.number}>
              <td className="proj-table__id">
                <a href={item.url} target="_blank" rel="noreferrer">
                  #{item.number}
                </a>
              </td>
              <td>
                <TypeBadge item={item} />
              </td>
              <td className="proj-table__title">{item.title}</td>
              <td>{item.parentNumber ? `#${item.parentNumber}` : '—'}</td>
              <td>{item.stageRaw ?? item.stage ?? '—'}</td>
              <td>{statusLabel(item)}</td>
              <td>{item.priority ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Modo árvore (collapse + drag-and-drop) ----------
// Dois arrastes: sem Shift = reparent (muda hierarquia, destaque de linha
// inteira); com Shift = reorder (só entre irmãos do mesmo grupo, linha de
// inserção). O modificador é lido no dragStart (não é confiável no dragover).

type DragMode = 'reparent' | 'reorder';

interface TreeCtx {
  dragged: number | null;
  dropTarget: number | null; // reparent: linha destacada
  insert: { number: number; pos: 'before' | 'after' } | null; // reorder: linha de inserção
  busy: boolean;
  collapsed: Set<number>;
  onToggle: (n: number) => void;
  onDragStart: (e: DragEvent, n: number) => void;
  onDragEnd: () => void;
  onDragOverRow: (e: DragEvent, target: SnapshotItem) => void;
  onDragLeaveRow: (target: SnapshotItem) => void;
  onDropRow: (e: DragEvent, target: SnapshotItem) => void;
}

function TreeNode({
  item,
  childrenByParent,
  depth,
  ctx,
}: {
  item: SnapshotItem;
  childrenByParent: Map<number, SnapshotItem[]>;
  depth: number;
  ctx: TreeCtx;
}) {
  const kids = childrenByParent.get(item.number) ?? [];
  const hasKids = kids.length > 0;
  const collapsed = ctx.collapsed.has(item.number);
  const cls = [
    'proj-tree__row',
    ctx.dragged === item.number ? 'proj-tree__row--dragging' : '',
    ctx.dropTarget === item.number ? 'proj-tree__row--dropok' : '',
    ctx.insert?.number === item.number ? `proj-tree__row--insert-${ctx.insert.pos}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li className="proj-tree__node">
      <div
        className={cls}
        style={{ paddingLeft: `${depth * 20 + 10}px` }}
        draggable={!ctx.busy}
        onDragStart={(e) => ctx.onDragStart(e, item.number)}
        onDragEnd={ctx.onDragEnd}
        onDragOver={(e) => ctx.onDragOverRow(e, item)}
        onDragLeave={() => ctx.onDragLeaveRow(item)}
        onDrop={(e) => ctx.onDropRow(e, item)}
        title="Arraste para reparentar · Shift+arraste para reordenar"
      >
        {hasKids ? (
          <button
            type="button"
            className="proj-tree__toggle"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expandir' : 'Colapsar'}
            draggable={false}
            onClick={() => ctx.onToggle(item.number)}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="proj-tree__toggle proj-tree__toggle--leaf" aria-hidden="true" />
        )}
        <span className="proj-tree__grip" aria-hidden="true">⠿</span>
        <TypeBadge item={item} />
        <a
          className="proj-tree__id"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          draggable={false}
        >
          #{item.number}
        </a>
        <span className="proj-tree__title">{item.title}</span>
        {item.stageRaw && <span className="proj-tree__stage">{item.stageRaw}</span>}
        {item.priority && <span className="proj-tree__prio">{item.priority}</span>}
        {item.state === 'closed' && <span className="proj-tree__closed">Fechado</span>}
      </div>
      {hasKids && !collapsed && (
        <ul className="proj-tree__children">
          {kids.map((kid) => (
            <TreeNode
              key={kid.number}
              item={kid}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreeView({
  items,
  repoId,
  refresh,
  order,
}: {
  items: SnapshotItem[];
  repoId: string;
  refresh: () => void;
  order: number[];
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const [mode, setMode] = useState<DragMode>('reparent');
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [insert, setInsert] = useState<{ number: number; pos: 'before' | 'after' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => readCollapsed(repoId));

  // Recarrega o estado colapsado ao trocar de repositório.
  useEffect(() => setCollapsed(readCollapsed(repoId)), [repoId]);

  const { topRoots, loose, childrenByParent, byNumber } = useMemo(() => {
    const byNumber = new Map(items.map((i) => [i.number, i]));
    // Ordena por índice na ordem custom (displayOrder); ausentes vão ao fim, por número.
    const rankOf = new Map(order.map((n, i) => [n, i]));
    const rank = (n: number) => rankOf.get(n) ?? Number.POSITIVE_INFINITY;
    const cmp = (a: SnapshotItem, b: SnapshotItem) => rank(a.number) - rank(b.number) || a.number - b.number;

    const childrenByParent = new Map<number, SnapshotItem[]>();
    for (const item of items) {
      if (item.parentNumber != null && byNumber.has(item.parentNumber)) {
        const list = childrenByParent.get(item.parentNumber) ?? [];
        list.push(item);
        childrenByParent.set(item.parentNumber, list);
      }
    }
    for (const list of childrenByParent.values()) list.sort(cmp);

    const hasParent = (i: SnapshotItem) => i.parentNumber != null && byNumber.has(i.parentNumber);
    const isInitiative = (i: SnapshotItem) => asType(i) === 'initiative';
    const topLevel = items.filter((i) => !hasParent(i)).sort(cmp);
    // Iniciativas SEMPRE no topo (mesmo sem filhos), reordenáveis entre si; depois
    // as demais raízes com filhos; "soltos" (sem pai e sem filhos) vão para o fim.
    const initiatives = topLevel.filter(isInitiative);
    const otherRoots = topLevel.filter((i) => !isInitiative(i) && childrenByParent.has(i.number));
    const loose = topLevel.filter((i) => !isInitiative(i) && !childrenByParent.has(i.number));
    return { topRoots: [...initiatives, ...otherRoots], loose, childrenByParent, byNumber };
  }, [items, order]);

  const onToggle = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      writeCollapsed(repoId, next);
      return next;
    });

  // Grupo de irmãos para reorder (mesma seção renderizada). Iniciativas são um
  // grupo à parte — reordenam só entre si e permanecem no topo.
  const groupKey = (i: SnapshotItem): string => {
    if (i.parentNumber != null && byNumber.has(i.parentNumber)) return `p${i.parentNumber}`;
    if (asType(i) === 'initiative') return 'initiatives';
    return childrenByParent.has(i.number) ? 'roots' : 'loose';
  };

  // `node` está na subárvore de `ancestor`? (bloqueia ciclos no reparent)
  const isDescendant = (ancestor: number, node: number): boolean => {
    for (const kid of childrenByParent.get(ancestor) ?? []) {
      if (kid.number === node || isDescendant(kid.number, node)) return true;
    }
    return false;
  };

  const validReparent = (target: SnapshotItem): boolean => {
    if (dragged == null || busy) return false;
    if (dragged === target.number) return false;
    const child = byNumber.get(dragged);
    if (!child) return false;
    if (child.parentNumber === target.number) return false; // já é o pai
    if (isDescendant(dragged, target.number)) return false; // ciclo
    const pt = asType(target);
    const ct = asType(child);
    if (!pt || !ct) return false;
    return isAllowedParent(pt, ct);
  };

  const validReorder = (target: SnapshotItem): boolean => {
    if (dragged == null || busy) return false;
    if (dragged === target.number) return false;
    const child = byNumber.get(dragged);
    if (!child) return false;
    return groupKey(child) === groupKey(target); // só entre irmãos do mesmo grupo
  };

  // Ordem global base = displayOrder (só itens atuais) + ausentes por número.
  const buildBaseOrder = (): number[] => {
    const present = new Set(items.map((i) => i.number));
    const base = order.filter((n) => present.has(n));
    const seen = new Set(base);
    const missing = items
      .map((i) => i.number)
      .filter((n) => !seen.has(n))
      .sort((a, b) => a - b);
    return [...base, ...missing];
  };

  const clearDrag = () => {
    setDragged(null);
    setDropTarget(null);
    setInsert(null);
  };

  const ctx: TreeCtx = {
    dragged,
    dropTarget,
    insert,
    busy,
    collapsed,
    onToggle,
    onDragStart: (e, n) => {
      setMode(e.shiftKey ? 'reorder' : 'reparent');
      e.dataTransfer.effectAllowed = 'move';
      setDragged(n);
    },
    onDragEnd: clearDrag,
    onDragOverRow: (e, target) => {
      if (mode === 'reorder') {
        if (!validReorder(target)) return;
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        if (insert?.number !== target.number || insert.pos !== pos) setInsert({ number: target.number, pos });
        if (dropTarget !== null) setDropTarget(null);
      } else {
        if (!validReparent(target)) return;
        e.preventDefault();
        if (dropTarget !== target.number) setDropTarget(target.number);
        if (insert !== null) setInsert(null);
      }
    },
    onDragLeaveRow: (target) => {
      if (dropTarget === target.number) setDropTarget(null);
      if (insert?.number === target.number) setInsert(null);
    },
    onDropRow: (e, target) => {
      e.preventDefault();
      const child = dragged;
      const ins = insert;
      const m = mode;
      clearDrag();
      if (child == null) return;

      if (m === 'reorder') {
        if (!validReorder(target)) return;
        const pos = ins?.number === target.number ? ins.pos : 'after';
        const arr = buildBaseOrder();
        const from = arr.indexOf(child);
        if (from >= 0) arr.splice(from, 1);
        let ti = arr.indexOf(target.number);
        if (ti < 0) return;
        if (pos === 'after') ti += 1;
        arr.splice(ti, 0, child);
        setBusy(true);
        reorderWorkItems(repoId, arr)
          .then(refresh)
          .catch((err: Error) => alert(err.message))
          .finally(() => setBusy(false));
      } else {
        if (!validReparent(target)) return;
        setBusy(true);
        reparentWorkItem(repoId, child, target.number)
          .then(refresh)
          .catch((err: Error) => alert(err.message))
          .finally(() => setBusy(false));
      }
    },
  };

  if (items.length === 0) return <p className="queue__empty">Nenhum item no projeto.</p>;

  return (
    <div className="proj-tree" aria-busy={busy}>
      <p className="proj-tree__hint">
        Arraste um item sobre outro para defini-lo como <strong>pai</strong> (hierarquia respeitada:
        Initiative → Epic → Feature → Story → Task). Segure <strong>Shift</strong> e arraste para
        <strong> reordenar</strong> entre irmãos.
      </p>
      {topRoots.length > 0 && (
        <ul className="proj-tree__list">
          {topRoots.map((item) => (
            <TreeNode
              key={item.number}
              item={item}
              childrenByParent={childrenByParent}
              depth={0}
              ctx={ctx}
            />
          ))}
        </ul>
      )}
      {loose.length > 0 && (
        <section className="ws-section">
          <h3 className="ws-section__title">
            Itens sem parent <span className="ws-section__count">{loose.length}</span>
          </h3>
          <ul className="proj-tree__list">
            {loose.map((item) => (
              <TreeNode
                key={item.number}
                item={item}
                childrenByParent={childrenByParent}
                depth={0}
                ctx={ctx}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- Página ----------

export function ProjectPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [view, setView] = useState<'table' | 'tree'>('table');
  const [creating, setCreating] = useState(false);
  const items = snapshot.items;

  return (
    <div className="ws-page">
      <div className="ws-toolbar">
        <div className="proj-viewtoggle" role="tablist" aria-label="Modo de visualização">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'table'}
            className={`btn btn--sm ${view === 'table' ? 'btn--accent' : ''}`}
            onClick={() => setView('table')}
          >
            Tabela
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'tree'}
            className={`btn btn--sm ${view === 'tree' ? 'btn--accent' : ''}`}
            onClick={() => setView('tree')}
          >
            Árvore
          </button>
        </div>
        <span className="ws-toolbar__spacer" />
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? 'Fechar' : '+ Novo item'}
        </button>
      </div>

      {creating && (
        <CreateForm
          items={items}
          repoId={repoId}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {view === 'table' ? (
        <TableView items={items} />
      ) : (
        <TreeView items={items} repoId={repoId} refresh={refresh} order={snapshot.displayOrder} />
      )}
    </div>
  );
}
