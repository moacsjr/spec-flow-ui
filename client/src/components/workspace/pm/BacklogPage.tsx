// Backlog do PM (spec "Tela de Backlog"): caixa de entrada de FEATURES/SPIKES.
// Responde: o que chegou? (capturar) · onde se encaixa? (organizar) · o que
// segue adiante? (priorizar). Projetada para ser ZERADA: priorizar um item o
// move de etapa (Feature → 🎯 Priorizado; Spike → ✅ Ready) e o tira da tela
// com animação otimista. Stories e Bugs jamais aparecem aqui.
//
// Layout: cabeçalho (contador + Nova feature + AI brainstorm) → faixa de
// insights (client-side) → árvore Initiative→Epic (navegação; colapso
// persistido) + tabela (Seleção/Feature/Área/Idade/Prioridade) com barra de
// ações em lote. Clique no título abre a Feature em drawer lateral.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Level, Priority, SnapshotItem } from '@spec-flow/shared';
import { PRIORITIES } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { ItemTable, type Column } from '../ItemTable';
import { AiSummary } from '../AiSummary';
import { FeatureDrawer } from '../FeatureDrawer';
import { ToastStack, useToasts } from '../Toasts';
import { hrefForWorkspace } from '../../../lib/router';
import { isOpen } from '../../../lib/workspaceSelectors';
import { isDescendantOf, itemsByNumber, typeSlug } from '../../../lib/workItemType';
import { createWorkItem } from '../../../data/workItem';
import {
  archiveWorkItem,
  bulkArchive,
  bulkPrioritize,
  bulkReparent,
  prioritizeWorkItem,
  type BulkResult,
} from '../../../data/workspace';
import { readCollapsed, writeCollapsed } from '../../../state/projectTreePrefs';

const DAY = 86_400_000;
const AGE_DANGER_DAYS = 30;
const EPIC_IDLE_DAYS = 60;
const LEAVE_MS = 200; // duração da animação de saída da linha
const AREAS = ['Frontend', 'Backend', 'Mobile', 'Infra', 'DevOps', 'Data'];
const MONTHS_FULL = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

// Tipos que compõem a árvore (navegação): Initiative → Epic.
const TREE_TYPES = ['initiative', 'epic'];
const TREE_RANK: Record<string, number> = { initiative: 0, epic: 1 };
// Tipos que aparecem na tabela (unidade de trabalho do Backlog).
const SCOPE_TYPES = new Set(['feature', 'spike']);

// Escopo da tela: Feature/Spike abertos ainda não triados. Etapa null = item
// fora do board — semanticamente também é "não triado" (inbox).
function inBacklogScope(item: SnapshotItem): boolean {
  return (
    SCOPE_TYPES.has(typeSlug(item)) &&
    isOpen(item) &&
    (item.stage === 'Backlog' || item.stage === null)
  );
}

// Itens já priorizados (toggle "Mostrar priorizadas"): somente leitura aqui.
function inPrioritizedScope(item: SnapshotItem): boolean {
  return SCOPE_TYPES.has(typeSlug(item)) && isOpen(item) && item.stage === 'Priorizado';
}

function ageDays(item: SnapshotItem): number {
  const ms = Date.now() - Date.parse(item.createdAt);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

// Level válido para rotas de work item (Spike herda 'feature' na inferência).
function levelOf(item: SnapshotItem): Level {
  return item.level === 'epic' || item.level === 'story' ? item.level : 'feature';
}

// ---------- Checkbox tri-state ----------

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

// ---------- Árvore (Initiative → Epic) ----------

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
  countOf: (n: number) => number;
  depth: number;
  selected: number | null;
  onSelect: (n: number) => void;
  collapsed: Set<number>;
  onToggle: (n: number) => void;
  onArchive: (node: SnapshotItem) => void;
  archiving: boolean;
}

function TreeNode(props: TreeNodeProps) {
  const { node, childrenMap, countOf, depth, selected, onSelect, collapsed, onToggle, onArchive, archiving } =
    props;
  const kids = childrenMap.get(node.number) ?? [];
  const hasKids = kids.length > 0;
  const isCollapsed = collapsed.has(node.number);

  return (
    <li className="bl-tree__node">
      <div
        className={`bl-tree__row${selected === node.number ? ' bl-tree__row--selected' : ''}`}
        style={{ paddingLeft: depth * 14 + 4 }}
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
          <span className="bl-tree__title">{node.title}</span>
        </button>
        <span className="bl-tree__count">{countOf(node.number)}</span>
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

// ---------- Form interino de criação (Feature/Spike sob um épico) ----------

function NovaFeatureForm({
  repoId,
  epics,
  presetEpic,
  onCreated,
  onCancel,
}: {
  repoId: string;
  epics: SnapshotItem[];
  presetEpic: number | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<'feature' | 'spike'>('feature');
  const [title, setTitle] = useState('');
  const [epicNumber, setEpicNumber] = useState(presetEpic ?? epics[0]?.number ?? 0);
  const [area, setArea] = useState('');
  const [saving, setSaving] = useState(false);

  if (epics.length === 0) {
    return (
      <p className="queue__empty">
        Crie primeiro um Épico no projeto — toda Feature/Spike nasce sob um Épico.
      </p>
    );
  }

  const submit = () => {
    if (!title.trim() || !epicNumber) return;
    setSaving(true);
    createWorkItem(repoId, {
      type,
      title: title.trim(),
      parentNumber: epicNumber,
      ...(area ? { area } : {}),
    })
      .then(onCreated)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="idea-form">
      <div className="bl-form__row">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'feature' | 'spike')}
          aria-label="Tipo"
        >
          <option value="feature">Feature</option>
          <option value="spike">Spike</option>
        </select>
        <input
          type="text"
          className="idea-form__title"
          placeholder="Título…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="bl-form__row">
        <select
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
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Área">
          <option value="">Área (opcional)</option>
          {AREAS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
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
          {saving ? 'Criando…' : 'Criar'}
        </button>
      </div>
    </div>
  );
}

// ---------- Página ----------

export function BacklogPage({ repoId, snapshot, refresh }: WorkspacePageProps) {
  // Cópia de trabalho (base do otimismo); re-sincroniza a cada snapshot.
  const [working, setWorking] = useState<SnapshotItem[]>(snapshot.items);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  useEffect(() => {
    setWorking(snapshot.items);
    setLeaving(new Set());
  }, [snapshot.items]);

  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => readCollapsed(repoId, 'backlog'));
  const [showPrioritized, setShowPrioritized] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [presetEpic, setPresetEpic] = useState<number | null>(null);
  const [brainstorm, setBrainstorm] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [drawerItem, setDrawerItem] = useState<SnapshotItem | null>(null);
  const { toasts, addToast, dismissToast } = useToasts();

  const byNumber = useMemo(() => itemsByNumber(working), [working]);

  // Escopo global (independe do filtro da árvore) — alimenta contador + insights.
  const backlogScope = useMemo(() => working.filter(inBacklogScope), [working]);

  // Árvore Initiative → Epic (só abertos).
  const { roots, childrenMap } = useMemo(() => {
    const hier = working.filter((i) => TREE_TYPES.includes(typeSlug(i)) && isOpen(i));
    const inTree = new Set(hier.map((i) => i.number));
    const map = new Map<number, SnapshotItem[]>();
    const rootList: SnapshotItem[] = [];
    for (const item of hier) {
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
  }, [working]);

  // Contador recursivo de não-triados sob um nó (árvore).
  const countUnder = (n: number) =>
    backlogScope.filter((i) => isDescendantOf(i, n, byNumber)).length;

  // Linhas visíveis: escopo Backlog (+ priorizadas com o toggle), filtradas pelo
  // nó e ordenadas do mais antigo para o mais novo (idade decrescente).
  const rows = useMemo(() => {
    const underNode = (i: SnapshotItem) =>
      selectedNode == null || isDescendantOf(i, selectedNode, byNumber);
    const base = backlogScope.filter(underNode);
    const prioritized = showPrioritized
      ? working.filter(inPrioritizedScope).filter(underNode)
      : [];
    return [...base, ...prioritized].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }, [backlogScope, working, selectedNode, byNumber, showPrioritized]);

  const epics = useMemo(
    () => working.filter((i) => typeSlug(i) === 'epic' && isOpen(i)),
    [working],
  );
  const selectedItem = selectedNode != null ? byNumber.get(selectedNode) ?? null : null;

  // ---- Insights (client-side; máx. 2, envelhecimento primeiro) ----
  const insights = useMemo(() => {
    const list: string[] = [];
    const aged = backlogScope.filter((i) => ageDays(i) > AGE_DANGER_DAYS).length;
    if (aged > 0) {
      list.push(
        aged === 1
          ? '1 feature está há mais de 30 dias sem triagem'
          : `${aged} features estão há mais de 30 dias sem triagem`,
      );
    }
    for (const epic of epics) {
      const children = working.filter((i) => i.parentNumber === epic.number);
      if (children.length === 0) continue;
      const lastCreated = Math.max(...children.map((c) => Date.parse(c.createdAt)));
      if (Number.isFinite(lastCreated) && Date.now() - lastCreated > EPIC_IDLE_DAYS * DAY) {
        const month = MONTHS_FULL[new Date(lastCreated).getMonth()];
        list.push(`o épico ${epic.title} não recebe itens novos desde ${month}`);
        break; // um épico ocioso por vez
      }
    }
    return list.slice(0, 2);
  }, [backlogScope, epics, working]);

  // ---- Colapso persistido ----
  const toggleCollapse = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      writeCollapsed(repoId, next, 'backlog');
      return next;
    });

  // ---- Priorização otimista ----

  // Aplica o efeito local da priorização (some do escopo do Backlog).
  const applyLocalPrioritize = (numbers: number[], priority: Priority) =>
    setWorking((items) =>
      items.map((it) =>
        numbers.includes(it.number)
          ? { ...it, priority, stage: typeSlug(it) === 'spike' ? 'Ready' : 'Priorizado' }
          : it,
      ),
    );

  // Reverte itens (restaura o estado pré-otimismo a partir de uma cópia).
  const revertItems = (originals: SnapshotItem[]) =>
    setWorking((items) =>
      items.map((it) => originals.find((o) => o.number === it.number) ?? it),
    );

  const handlePrioritize = (item: SnapshotItem, priority: Priority) => {
    const original = { ...item };
    // 1. anima a saída; 2. após a animação, remove do escopo (otimista).
    setLeaving((s) => new Set(s).add(item.number));
    window.setTimeout(() => {
      applyLocalPrioritize([item.number], priority);
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(item.number);
        return next;
      });
    }, LEAVE_MS);

    prioritizeWorkItem(repoId, levelOf(item), item.number, priority)
      .then(() => refresh())
      .catch((err: Error) => {
        revertItems([original]);
        addToast(`Falha ao priorizar #${item.number}: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => handlePrioritize(item, priority),
        });
      });
  };

  // ---- Seleção múltipla + ações em lote ----
  const selectableRows = rows.filter(inBacklogScope);
  const pickedVisible = selectableRows.filter((r) => picked.has(r.number));
  const allChecked = selectableRows.length > 0 && pickedVisible.length === selectableRows.length;
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
      if (allChecked) selectableRows.forEach((r) => next.delete(r.number));
      else selectableRows.forEach((r) => next.add(r.number));
      return next;
    });

  // Trata a resposta por item de um lote: reverte SÓ os que falharam.
  const settleBulk = (
    results: BulkResult[],
    originals: SnapshotItem[],
    retry: (failed: number[]) => void,
  ) => {
    const failed = results.filter((r) => !r.ok).map((r) => r.number);
    if (failed.length > 0) {
      revertItems(originals.filter((o) => failed.includes(o.number)));
      addToast(`${failed.length} de ${results.length} itens falharam.`, {
        label: 'Tentar novamente',
        run: () => retry(failed),
      });
    }
    refresh();
  };

  const applyBulkPriority = (priority: Priority, targetNumbers?: number[]) => {
    const numbers = targetNumbers ?? [...picked];
    const targets = working.filter((i) => numbers.includes(i.number));
    if (targets.length === 0) return;
    const originals = targets.map((t) => ({ ...t }));
    setBulkSaving(true);
    applyLocalPrioritize(numbers, priority);
    setPicked(new Set());
    bulkPrioritize(repoId, numbers, priority)
      .then((results) => settleBulk(results, originals, (failed) => applyBulkPriority(priority, failed)))
      .catch((err: Error) => {
        revertItems(originals);
        addToast(`Falha ao priorizar em lote: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => applyBulkPriority(priority, numbers),
        });
      })
      .finally(() => setBulkSaving(false));
  };

  const applyBulkMove = (parentNumber: number, targetNumbers?: number[]) => {
    const numbers = targetNumbers ?? [...picked];
    const targets = working.filter((i) => numbers.includes(i.number));
    if (targets.length === 0) return;
    const originals = targets.map((t) => ({ ...t }));
    setBulkSaving(true);
    setWorking((items) =>
      items.map((it) => (numbers.includes(it.number) ? { ...it, parentNumber } : it)),
    );
    setPicked(new Set());
    bulkReparent(repoId, numbers, parentNumber)
      .then((results) => settleBulk(results, originals, (failed) => applyBulkMove(parentNumber, failed)))
      .catch((err: Error) => {
        revertItems(originals);
        addToast(`Falha ao mover para o épico: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => applyBulkMove(parentNumber, numbers),
        });
      })
      .finally(() => setBulkSaving(false));
  };

  const applyBulkArchive = (targetNumbers?: number[]) => {
    const numbers = targetNumbers ?? [...picked];
    if (numbers.length === 0) return;
    if (!targetNumbers && !confirm(`Arquivar ${numbers.length} item(ns)?`)) return;
    const targets = working.filter((i) => numbers.includes(i.number));
    const originals = targets.map((t) => ({ ...t }));
    setBulkSaving(true);
    setWorking((items) =>
      items.map((it) => (numbers.includes(it.number) ? { ...it, state: 'closed' as const } : it)),
    );
    setPicked(new Set());
    bulkArchive(repoId, numbers)
      .then((results) => settleBulk(results, originals, (failed) => applyBulkArchive(failed)))
      .catch((err: Error) => {
        revertItems(originals);
        addToast(`Falha ao arquivar: ${err.message}`, {
          label: 'Tentar novamente',
          run: () => applyBulkArchive(numbers),
        });
      })
      .finally(() => setBulkSaving(false));
  };

  // ---- Arquivar em cascata pela árvore (mantido por decisão do usuário) ----
  const handleArchiveNode = (node: SnapshotItem) => {
    const total = working.filter(
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
    if (selectedNode === node.number) setSelectedNode(null);
    archiveWorkItem(repoId, typeSlug(node), node.number)
      .catch(() =>
        addToast('O arquivamento pode ainda estar concluindo no servidor. A lista será atualizada.'),
      )
      .finally(() => {
        setArchiving(false);
        refresh();
      });
  };

  // ---- Colunas ----
  const columns: Column[] = [
    {
      header: 'check',
      className: 'proj-table__check',
      headerCell: (
        <TriCheckbox
          checked={allChecked}
          indeterminate={someChecked}
          onChange={toggleAll}
          ariaLabel="Selecionar todas as features visíveis"
        />
      ),
      cell: (item) =>
        inBacklogScope(item) ? (
          <TriCheckbox
            checked={picked.has(item.number)}
            onChange={() => toggleOne(item.number)}
            ariaLabel={`Selecionar #${item.number}`}
          />
        ) : null,
    },
    {
      header: 'Feature',
      className: 'bl-col-feature',
      cell: (item) => {
        const slug = typeSlug(item);
        return (
          <button
            type="button"
            className="bl-featbtn"
            onClick={() => setDrawerItem(item)}
            title={item.title}
          >
            <span className={`proj-badge proj-badge--${slug}`}>
              {slug === 'spike' ? 'SPIKE' : 'FEAT'}
            </span>
            <span className="mono bl-featbtn__num">#{item.number}</span>
            <span className="bl-featbtn__title">{item.title}</span>
          </button>
        );
      },
    },
    {
      header: 'Área',
      className: 'bl-col-area',
      cell: (item) => item.area ?? <span className="pl2-dim">—</span>,
    },
    {
      header: 'Idade',
      className: 'bl-col-age',
      cell: (item) => {
        const days = ageDays(item);
        return (
          <span className={`mono${days > AGE_DANGER_DAYS ? ' bl-age--old' : ''}`}>{days}d</span>
        );
      },
    },
    {
      header: 'Prioridade',
      className: 'bl-col-prio',
      cell: (item) =>
        inBacklogScope(item) ? (
          <select
            className="queue__priosel"
            value=""
            disabled={leaving.has(item.number) || bulkSaving}
            aria-label={`Prioridade de #${item.number}`}
            title={
              typeSlug(item) === 'spike'
                ? 'Spikes priorizados vão direto ao backlog técnico'
                : undefined
            }
            onChange={(e) => {
              if (e.target.value) handlePrioritize(item, e.target.value as Priority);
            }}
          >
            <option value="">—</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <span className={`chip chip--${item.priority?.toLowerCase() ?? 'p3'}`}>
            {item.priority ?? '—'}
          </span>
        ),
    },
  ];

  const rowClassName = (item: SnapshotItem) => {
    const classes = ['bl-row'];
    if (leaving.has(item.number)) classes.push('bl-row--leaving');
    if (!inBacklogScope(item)) classes.push('bl-row--dim');
    if (picked.has(item.number)) classes.push('bl-row--picked');
    return classes.join(' ');
  };

  // ---- Estados vazios ----
  const emptyNode =
    roots.length === 0 ? (
      <div className="bl-empty">
        <span className="bl-empty__icon">🌱</span>
        <p>O projeto ainda não tem Iniciativas nem Épicos.</p>
        <div className="bl-empty__actions">
          <button type="button" className="btn btn--sm btn--accent" onClick={() => setBrainstorm(true)}>
            ✨ AI brainstorm
          </button>
          <a className="btn btn--sm" href={hrefForWorkspace('pm', 'project')}>
            Criar estrutura na view Project
          </a>
        </div>
      </div>
    ) : selectedItem ? (
      <div className="bl-empty">
        <span className="bl-empty__icon">📭</span>
        <p>Nenhum item sob {selectedItem.title}.</p>
        <div className="bl-empty__actions">
          <button
            type="button"
            className="btn btn--sm btn--accent"
            onClick={() => {
              setPresetEpic(typeSlug(selectedItem) === 'epic' ? selectedItem.number : null);
              setCreating(true);
            }}
          >
            + Nova feature
          </button>
        </div>
      </div>
    ) : (
      <div className="bl-empty">
        <span className="bl-empty__icon">🎉</span>
        <p>Backlog zerado — nenhuma feature aguardando triagem.</p>
        <div className="bl-empty__actions">
          <button
            type="button"
            className="btn btn--sm btn--accent"
            onClick={() => {
              setPresetEpic(null);
              setCreating(true);
            }}
          >
            + Nova feature
          </button>
          <a className="btn btn--sm" href={hrefForWorkspace('pm', 'prioritization')}>
            Ver Prioritization
          </a>
        </div>
      </div>
    );

  return (
    <div className="ws-page">
      {/* Cabeçalho */}
      <div className="bl-head">
        <span className="bl-head__count">
          {backlogScope.length} feature{backlogScope.length === 1 ? '' : 's'} aguardando triagem
        </span>
        <span className="ws-toolbar__spacer" />
        <button type="button" className="btn btn--sm" onClick={() => setBrainstorm((v) => !v)}>
          ✨ AI brainstorm
        </button>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={() => {
            setPresetEpic(null);
            setCreating((v) => !v);
          }}
        >
          + Nova feature
        </button>
      </div>

      {/* Faixa de insights */}
      {insights.length > 0 && <div className="bl-insights">💡 {insights.join('; ')}.</div>}

      {creating && (
        <NovaFeatureForm
          repoId={repoId}
          epics={epics}
          presetEpic={presetEpic}
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
        {/* Árvore */}
        <aside className="bl-tree-pane">
          <div className="bl-pane__head">Hierarquia</div>
          <button
            type="button"
            className={`bl-tree__all${selectedNode == null ? ' bl-tree__row--selected' : ''}`}
            onClick={() => setSelectedNode(null)}
          >
            Todas <span className="bl-tree__count">{backlogScope.length}</span>
          </button>
          {roots.length === 0 ? (
            <p className="queue__empty">Sem Iniciativas/Épicos.</p>
          ) : (
            <ul className="bl-tree">
              {roots.map((node) => (
                <TreeNode
                  key={node.number}
                  node={node}
                  childrenMap={childrenMap}
                  countOf={countUnder}
                  depth={0}
                  selected={selectedNode}
                  onSelect={(n) => setSelectedNode((cur) => (cur === n ? null : n))}
                  collapsed={collapsed}
                  onToggle={toggleCollapse}
                  onArchive={handleArchiveNode}
                  archiving={archiving}
                />
              ))}
            </ul>
          )}
          <label className="bl-tree-foot">
            <input
              type="checkbox"
              className="bl-check"
              checked={showPrioritized}
              onChange={(e) => setShowPrioritized(e.target.checked)}
            />
            Mostrar priorizadas
          </label>
        </aside>

        {/* Tabela */}
        <div className="bl-stories-pane">
          {picked.size > 0 ? (
            <div className="bl-bulkbar">
              <span className="bl-bulkbar__count">{picked.size} selecionada(s)</span>
              <label className="bl-bulkbar__label">
                Priorizar
                <select
                  className="queue__priosel"
                  value=""
                  disabled={bulkSaving}
                  aria-label="Priorizar selecionadas"
                  onChange={(e) => {
                    if (e.target.value) applyBulkPriority(e.target.value as Priority);
                    e.target.value = '';
                  }}
                >
                  <option value="">P?</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bl-bulkbar__label">
                Mover para épico
                <select
                  className="queue__priosel"
                  value=""
                  disabled={bulkSaving}
                  aria-label="Mover selecionadas para um épico"
                  onChange={(e) => {
                    if (e.target.value) applyBulkMove(Number(e.target.value));
                    e.target.value = '';
                  }}
                >
                  <option value="">Escolher…</option>
                  {epics.map((epic) => (
                    <option key={epic.number} value={epic.number}>
                      #{epic.number} {epic.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--sm"
                disabled={bulkSaving}
                onClick={() => applyBulkArchive()}
              >
                Arquivar
              </button>
              {bulkSaving && (
                <span className="bl-bulkbar__status" role="status">
                  <span className="spinner" aria-hidden="true" /> Aplicando…
                </span>
              )}
              <button
                type="button"
                className="btn btn--sm bl-bulkbar__clear"
                onClick={() => setPicked(new Set())}
                disabled={bulkSaving}
              >
                Limpar seleção
              </button>
            </div>
          ) : (
            <div className="bl-pane__head">
              Features
              {selectedItem && (
                <span className="bl-pane__filter">
                  · {selectedItem.title}
                  <button
                    type="button"
                    className="bl-pane__clear"
                    onClick={() => setSelectedNode(null)}
                    aria-label="Limpar filtro"
                  >
                    ✕
                  </button>
                </span>
              )}
              <span className="ws-section__count">{rows.length}</span>
            </div>
          )}

          <ItemTable items={rows} columns={columns} empty="" emptyNode={emptyNode} rowClassName={rowClassName} />
        </div>
      </div>

      {drawerItem && (
        <FeatureDrawer repoId={repoId} item={drawerItem} onClose={() => setDrawerItem(null)} />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
