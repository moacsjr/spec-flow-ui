// Backlog do PM (RFC-003 §2): explorador do projeto em duas colunas.
//   • Esquerda: árvore da hierarquia Iniciativa → Épico → Feature.
//   • Direita: tabela com TODAS as Stories do projeto.
// Clicar num nó da árvore (Iniciativa/Épico/Feature) filtra a tabela para as
// Stories descendentes dele. Ações de topo: Create Idea (Feature sob um Épico),
// AI Brainstorm.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Priority, SnapshotItem } from '@spec-flow/shared';
import { PRIORITIES } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { ItemTable, type Column } from '../ItemTable';
import { TypeBadge } from '../TypeBadge';
import { AiSummary } from '../AiSummary';
import { hrefForItem } from '../../../lib/router';
import { isEpic, isOpen, isStory } from '../../../lib/workspaceSelectors';
import {
  ancestorOfType,
  isDescendantOf,
  itemsByNumber,
  typeOf,
  typeSlug,
} from '../../../lib/workItemType';
import { createFeature } from '../../../data/workItem';
import { archiveWorkItem, setPriority } from '../../../data/workspace';

// Checkbox com estado "indeterminado" (parcialmente selecionado) — só via ref.
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !checked && !!indeterminate;
  }, [checked, indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="bl-check"
      checked={checked}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  );
}

// Tipos que compõem a árvore de hierarquia (Stories/Tasks ficam de fora).
const TREE_TYPES = ['initiative', 'epic', 'feature'];
const TREE_RANK: Record<string, number> = { initiative: 0, epic: 1, feature: 2 };

function itemHref(repoId: string, item: SnapshotItem): { href: string; external: boolean } {
  if (item.level === 'epic' || item.level === 'feature' || item.level === 'story') {
    return { href: hrefForItem(repoId, item.level, item.number), external: false };
  }
  return { href: item.url, external: true };
}

// Célula "ancestral" (Feature/Epic/Iniciativa) — título com número esmaecido.
function ancestorCell(item: SnapshotItem | null) {
  return item ? (
    <span className="proj-table__parent">
      <span className="proj-table__parentnum">#{item.number}</span> {item.title}
    </span>
  ) : (
    '—'
  );
}

// ---------- Árvore da hierarquia ----------

function ArchiveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="5" rx="1" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

interface TreeNodeProps {
  node: SnapshotItem;
  childrenMap: Map<number, SnapshotItem[]>;
  depth: number;
  selected: number | null;
  onSelect: (n: number) => void;
  collapsed: Set<number>;
  onToggle: (n: number) => void;
  onArchive: (node: SnapshotItem) => void;
  archiving: boolean;
}

function TreeNode(props: TreeNodeProps) {
  const { node, childrenMap, depth, selected, onSelect, collapsed, onToggle, onArchive, archiving } =
    props;
  const kids = childrenMap.get(node.number) ?? [];
  const hasKids = kids.length > 0;
  const isCollapsed = collapsed.has(node.number);

  return (
    <li className="bl-tree__node">
      <div
        className={`bl-tree__row${selected === node.number ? ' bl-tree__row--selected' : ''}`}
        style={{ paddingLeft: depth * 16 + 6 }}
      >
        {hasKids ? (
          <button
            type="button"
            className="bl-tree__toggle"
            onClick={() => onToggle(node.number)}
            aria-label={isCollapsed ? 'Expandir' : 'Recolher'}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="bl-tree__toggle bl-tree__toggle--leaf" />
        )}
        <button
          type="button"
          className="bl-tree__label"
          onClick={() => onSelect(node.number)}
          aria-pressed={selected === node.number}
          title={`#${node.number} ${node.title}`}
        >
          <TypeBadge item={node} />
          <span className="bl-tree__title">{node.title}</span>
        </button>
        <button
          type="button"
          className="bl-tree__archive"
          title="Arquivar (fecha o item e todos os filhos)"
          aria-label={`Arquivar ${node.title}`}
          disabled={archiving}
          onClick={(e) => {
            e.stopPropagation();
            onArchive(node);
          }}
        >
          <ArchiveIcon />
        </button>
      </div>
      {hasKids && !isCollapsed && (
        <ul className="bl-tree__children">
          {kids.map((kid) => (
            <TreeNode key={kid.number} {...props} node={kid} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------- Formulário: criar ideia (Feature sob um Épico) ----------

function CreateIdeaForm({
  epics,
  onCreated,
  onCancel,
  repoId,
}: {
  repoId: string;
  epics: SnapshotItem[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [epicNumber, setEpicNumber] = useState(epics[0]?.number ?? 0);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = () => {
    if (!title.trim() || !epicNumber) return;
    setSaving(true);
    createFeature(repoId, epicNumber, {
      title: title.trim(),
      ...(description.trim() ? { descriptionMdx: description.trim() } : {}),
    })
      .then(onCreated)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  if (epics.length === 0) {
    return (
      <p className="queue__empty">
        Crie primeiro um Épico no repositório — toda ideia (Feature) nasce sob um Épico.
      </p>
    );
  }

  return (
    <div className="idea-form">
      <input
        type="text"
        className="idea-form__title"
        placeholder="Título da ideia…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <select
        className="idea-form__epic"
        value={epicNumber}
        onChange={(e) => setEpicNumber(Number(e.target.value))}
        aria-label="Épico pai"
      >
        {epics.map((epic) => (
          <option key={epic.number} value={epic.number}>
            #{epic.number} {epic.title}
          </option>
        ))}
      </select>
      <textarea
        className="idea-form__desc"
        placeholder="Descrição (opcional)…"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="idea-form__actions">
        <button type="button" className="btn btn--sm" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={submit}
          disabled={saving || !title.trim()}
        >
          {saving ? 'Criando…' : 'Criar ideia'}
        </button>
      </div>
    </div>
  );
}

export function BacklogPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  const [creating, setCreating] = useState(false);
  const [brainstorm, setBrainstorm] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<Set<number>>(new Set()); // stories marcadas p/ ação em lote
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set()); // linhas com gravação em andamento
  const [bulkSaving, setBulkSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const byNumber = useMemo(() => itemsByNumber(snapshot.items), [snapshot.items]);

  // Forest da hierarquia: raízes + filhos por número de pai, ordenados por
  // rank (Iniciativa → Épico → Feature) e depois número. Só itens abertos —
  // arquivar (fechar) remove o item do Backlog.
  const { roots, childrenMap } = useMemo(() => {
    const hierItems = snapshot.items.filter((i) => TREE_TYPES.includes(typeSlug(i)) && isOpen(i));
    const inTree = new Set(hierItems.map((i) => i.number));
    const map = new Map<number, SnapshotItem[]>();
    const rootList: SnapshotItem[] = [];
    for (const item of hierItems) {
      const parent = item.parentNumber;
      if (parent != null && inTree.has(parent)) {
        const bucket = map.get(parent);
        if (bucket) bucket.push(item);
        else map.set(parent, [item]);
      } else {
        rootList.push(item);
      }
    }
    const cmp = (a: SnapshotItem, b: SnapshotItem) =>
      (TREE_RANK[typeSlug(a)] ?? 9) - (TREE_RANK[typeSlug(b)] ?? 9) || a.number - b.number;
    rootList.sort(cmp);
    for (const bucket of map.values()) bucket.sort(cmp);
    return { roots: rootList, childrenMap: map };
  }, [snapshot.items]);

  // Stories abertas do projeto (arquivadas/fechadas saem do Backlog).
  const stories = useMemo(() => snapshot.items.filter((i) => isStory(i) && isOpen(i)), [snapshot.items]);

  const visibleStories = useMemo(
    () =>
      selected == null
        ? stories
        : stories.filter((s) => isDescendantOf(s, selected, byNumber)),
    [stories, selected, byNumber],
  );

  const epics = snapshot.items.filter((i) => isEpic(i) && isOpen(i));

  const selectedItem = selected != null ? byNumber.get(selected) ?? null : null;

  const toggle = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  // Arquiva (fecha) o nó + todos os descendentes abertos, após confirmação.
  const handleArchive = (node: SnapshotItem) => {
    const total = snapshot.items.filter(
      (i) => isOpen(i) && (i.number === node.number || isDescendantOf(i, node.number, byNumber)),
    ).length;
    const descendants = total - 1;
    const msg =
      `Arquivar "${node.title}"?\n\n` +
      (descendants > 0
        ? `Serão fechadas ${total} issues (o item e ${descendants} descendente(s) aberto(s)).`
        : 'Esta issue será fechada.') +
      '\n\nVocê pode reabri-las no GitHub depois.';
    if (!confirm(msg)) return;
    setArchiving(true);
    if (selected === node.number) setSelected(null);
    archiveWorkItem(repoId, typeSlug(node), node.number)
      .catch(() =>
        // Subárvores grandes podem estourar o timeout do gateway enquanto o
        // fechamento continua no servidor — o refresh abaixo reflete o estado real.
        alert(
          'O arquivamento demorou mais que o esperado e pode ainda estar concluindo no servidor. A lista será atualizada.',
        ),
      )
      .finally(() => {
        setArchiving(false);
        refresh();
      });
  };

  const busy = savingIds.size > 0 || bulkSaving;

  const addSaving = (nums: number[]) =>
    setSavingIds((prev) => new Set([...prev, ...nums]));
  const clearSaving = (nums: number[]) =>
    setSavingIds((prev) => {
      const next = new Set(prev);
      nums.forEach((n) => next.delete(n));
      return next;
    });

  // ---- Multi-seleção para ação em lote ----
  const pickedVisible = visibleStories.filter((s) => picked.has(s.number));
  const allChecked = visibleStories.length > 0 && pickedVisible.length === visibleStories.length;
  const someChecked = pickedVisible.length > 0 && !allChecked;

  const toggleOne = (n: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  const toggleAll = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (allChecked) visibleStories.forEach((s) => next.delete(s.number));
      else visibleStories.forEach((s) => next.add(s.number));
      return next;
    });

  // Grava a prioridade de um item, com spinner na linha até recarregar o snapshot.
  const setOnePriority = (item: SnapshotItem, priority: Priority | null) => {
    addSaving([item.number]);
    setPriority(repoId, item.level, item.number, priority)
      .then(() => refresh())
      .catch((err: Error) => alert(err.message))
      .finally(() => clearSaving([item.number]));
  };

  // Aplica a prioridade a todas as stories marcadas (uma chamada por item).
  const applyBulkPriority = (priority: Priority | null) => {
    const targets = stories.filter((s) => picked.has(s.number));
    if (targets.length === 0) return;
    const nums = targets.map((s) => s.number);
    setBulkSaving(true);
    addSaving(nums);
    Promise.all(targets.map((s) => setPriority(repoId, s.level, s.number, priority)))
      .then(() => {
        setPicked(new Set());
        return refresh();
      })
      .catch((err: Error) => alert(err.message))
      .finally(() => {
        setBulkSaving(false);
        clearSaving(nums);
      });
  };

  const columns: Column[] = [
    {
      header: 'check',
      className: 'proj-table__check',
      headerCell: (
        <TriCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={toggleAll}
          ariaLabel="Selecionar todas as stories visíveis"
        />
      ),
      cell: (item) => (
        <TriCheckbox
          checked={picked.has(item.number)}
          onChange={() => toggleOne(item.number)}
          ariaLabel={`Selecionar #${item.number}`}
        />
      ),
    },
    {
      header: 'Issue Id',
      className: 'proj-table__id',
      cell: (item) => {
        const { href, external } = itemHref(repoId, item);
        return (
          <a href={href} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
            #{item.number}
          </a>
        );
      },
    },
    { header: 'Type', cell: (item) => <TypeBadge item={item} /> },
    {
      header: 'Title',
      className: 'proj-table__title',
      cell: (item) => {
        const { href, external } = itemHref(repoId, item);
        return (
          <a
            className="proj-table__titlelink"
            href={href}
            {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {item.title}
          </a>
        );
      },
    },
    { header: 'Feature', cell: (item) => ancestorCell(ancestorOfType(item, byNumber, 'feature')) },
    { header: 'Epic', cell: (item) => ancestorCell(ancestorOfType(item, byNumber, 'epic')) },
    {
      header: 'Iniciativa',
      cell: (item) => ancestorCell(ancestorOfType(item, byNumber, 'initiative')),
    },
    { header: 'Status', cell: (item) => (item.state === 'closed' ? 'Fechado' : 'Aberto') },
    {
      header: 'Etapa',
      cell: (item) =>
        item.stageRaw ?? item.stage ? (
          <span className="chip chip--stage">{item.stageRaw ?? item.stage}</span>
        ) : (
          '—'
        ),
    },
    {
      header: 'Priority',
      cell: (item) => {
        const saving = savingIds.has(item.number);
        return (
          <span className="bl-priocell">
            <select
              className="queue__priosel"
              value={item.priority ?? ''}
              disabled={saving || bulkSaving}
              aria-label={`Prioridade de #${item.number}`}
              onChange={(e) => setOnePriority(item, (e.target.value || null) as Priority | null)}
            >
              <option value="">—</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {saving && <span className="spinner" aria-hidden="true" />}
          </span>
        );
      },
    },
  ];

  return (
    <div className="ws-page">
      <div className="ws-toolbar">
        <span className="ws-toolbar__spacer" />
        <button type="button" className="btn btn--sm" onClick={() => setBrainstorm((v) => !v)}>
          ✨ AI Brainstorm
        </button>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={() => setCreating((v) => !v)}
        >
          + Create Idea
        </button>
      </div>

      {creating && (
        <CreateIdeaForm
          repoId={repoId}
          epics={epics}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {brainstorm && (
        <AiSummary
          repoId={repoId}
          scope="brainstorm"
          title="AI Brainstorm"
          topicPlaceholder="Tema (opcional)…"
        />
      )}

      <div className="bl-split">
        <aside className="bl-tree-pane">
          <div className="bl-pane__head">Hierarquia</div>
          <button
            type="button"
            className={`bl-tree__all${selected == null ? ' bl-tree__row--selected' : ''}`}
            onClick={() => setSelected(null)}
          >
            Todo o projeto
          </button>
          {roots.length === 0 ? (
            <p className="queue__empty">Sem Iniciativas/Épicos/Features no projeto.</p>
          ) : (
            <ul className="bl-tree">
              {roots.map((node) => (
                <TreeNode
                  key={node.number}
                  node={node}
                  childrenMap={childrenMap}
                  depth={0}
                  selected={selected}
                  onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
                  collapsed={collapsed}
                  onToggle={toggle}
                  onArchive={handleArchive}
                  archiving={archiving}
                />
              ))}
            </ul>
          )}
        </aside>

        <div className="bl-stories-pane">
          <div className="bl-pane__head">
            Stories
            {selectedItem && (
              <span className="bl-pane__filter">
                · {typeOf(selectedItem)} #{selectedItem.number} {selectedItem.title}
                <button
                  type="button"
                  className="bl-pane__clear"
                  onClick={() => setSelected(null)}
                  aria-label="Limpar filtro"
                >
                  ✕
                </button>
              </span>
            )}
            <span className="ws-section__count">{visibleStories.length}</span>
          </div>

          {picked.size > 0 && (
            <div className="bl-bulkbar">
              <span className="bl-bulkbar__count">{picked.size} selecionada(s)</span>
              <label className="bl-bulkbar__label">
                Definir prioridade
                <select
                  className="queue__priosel"
                  value=""
                  disabled={busy}
                  aria-label="Definir prioridade das selecionadas"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) applyBulkPriority(v === 'none' ? null : (v as Priority));
                    e.target.value = '';
                  }}
                >
                  <option value="">Escolher…</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="none">Remover prioridade</option>
                </select>
              </label>
              {bulkSaving && (
                <span className="bl-bulkbar__status" role="status">
                  <span className="spinner" aria-hidden="true" /> Aplicando…
                </span>
              )}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPicked(new Set())}
                disabled={busy}
              >
                Limpar seleção
              </button>
            </div>
          )}

          <ItemTable
            items={visibleStories}
            columns={columns}
            empty={
              selected == null
                ? 'Nenhuma Story no projeto.'
                : 'Nenhuma Story sob o item selecionado.'
            }
          />
        </div>
      </div>
    </div>
  );
}
