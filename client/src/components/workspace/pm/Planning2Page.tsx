// Planning2 (Backlog Planner) — visão de planejamento do PM em 3 colunas:
//   1. Hierarquia (Iniciativa → Épico → Feature) + card de métricas do nó.
//   2. Story Backlog: stories do escopo selecionado; origem do drag-and-drop.
//   3. Milestones: cards com progresso por Story Points + zona de drop.
// Arrastar uma story para um milestone (ou usar o dropdown do card) atribui o
// milestone imediatamente (otimista) e persiste via API. Dados reais do snapshot.

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { MilestoneSummary, SnapshotItem } from '@spec-flow/shared';
import type { WorkspacePageProps } from '../types';
import { TypeBadge } from '../TypeBadge';
import { isStory } from '../../../lib/workspaceSelectors';
import { ancestorOfType, isDescendantOf, itemsByNumber, typeSlug } from '../../../lib/workItemType';
import { hrefForItem } from '../../../lib/router';
import { createMilestone, setStoryMilestone } from '../../../data/workspace';

const TREE_TYPES = ['initiative', 'epic', 'feature'];
const TREE_RANK: Record<string, number> = { initiative: 0, epic: 1, feature: 2 };
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function firstEpicNumber(items: SnapshotItem[]): number | null {
  return items.find((i) => typeSlug(i) === 'epic')?.number ?? null;
}

function isDone(story: SnapshotItem): boolean {
  return story.state === 'closed' || story.stage === 'Done';
}

function formatEta(dueOn: string | null): string | null {
  if (!dueOn) return null;
  const d = new Date(dueOn);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS_PT[d.getUTCMonth()]}`;
}

interface MilestoneStats {
  planned: number;
  completed: number;
  storyCount: number;
  pct: number;
}

// ---------- Árvore ----------

interface TreeNodeProps {
  node: SnapshotItem;
  childrenMap: Map<number, SnapshotItem[]>;
  storyCountOf: (n: number) => number;
  depth: number;
  selected: number | null;
  onSelect: (n: number) => void;
  collapsed: Set<number>;
  onToggle: (n: number) => void;
}

function TreeNode(props: TreeNodeProps) {
  const { node, childrenMap, storyCountOf, depth, selected, onSelect, collapsed, onToggle } = props;
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
        <span className="pl2-tree__count">{storyCountOf(node.number)}</span>
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

// ---------- Form de novo milestone ----------

function MilestoneForm({
  repoId,
  onDone,
  onCancel,
}: {
  repoId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = () => {
    if (!title.trim()) return;
    setSaving(true);
    createMilestone(repoId, { title: title.trim(), dueOn: dueOn || undefined })
      .then(onDone)
      .catch((err: Error) => alert(err.message))
      .finally(() => setSaving(false));
  };

  return (
    <div className="pl2-msform">
      <input
        type="text"
        placeholder="Nome do milestone…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Nome do milestone"
      />
      <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Data-alvo" />
      <div className="pl2-msform__actions">
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

export function Planning2Page({ repoId, snapshot, refresh, query }: WorkspacePageProps) {
  // Filtro por milestone vindo do hash (?milestone=N) — usado pelo CTA "Abrir
  // Planejamento" da tela de Milestones. Estado local para poder limpar.
  const [milestoneFilter, setMilestoneFilter] = useState<number | null>(() => {
    const n = query?.milestone ? Number(query.milestone) : NaN;
    return Number.isInteger(n) ? n : null;
  });
  // Cópia de trabalho dos items — base da atualização otimista; re-sincroniza
  // quando o snapshot é recarregado.
  const [working, setWorking] = useState<SnapshotItem[]>(snapshot.items);
  useEffect(() => setWorking(snapshot.items), [snapshot.items]);

  const [selected, setSelected] = useState<number | null>(() => firstEpicNumber(snapshot.items));
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msForm, setMsForm] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  // Dropdown aberto numa linha: pill de milestone ou menu de ações.
  const [openMenu, setOpenMenu] = useState<{ story: number; kind: 'milestone' | 'actions' } | null>(
    null,
  );

  const byNumber = useMemo(() => itemsByNumber(working), [working]);
  const milestones = useMemo(
    () => snapshot.milestones.filter((m) => m.state === 'open'),
    [snapshot.milestones],
  );

  // Fecha dropdowns em Escape / clique fora.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.pl2-pop, .pl2-pillbtn, .pl2-iconbtn')) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // Forest da hierarquia (Iniciativa → Épico → Feature).
  const { roots, childrenMap } = useMemo(() => {
    const hier = working.filter((i) => TREE_TYPES.includes(typeSlug(i)));
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

  const stories = useMemo(() => working.filter(isStory), [working]);

  const storiesUnder = (nodeNumber: number | null): SnapshotItem[] =>
    nodeNumber == null ? stories : stories.filter((s) => isDescendantOf(s, nodeNumber, byNumber));

  const visibleStories = useMemo(
    () =>
      storiesUnder(selected).filter(
        (s) => milestoneFilter == null || s.milestone?.number === milestoneFilter,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, selected, byNumber, milestoneFilter],
  );

  const filterMilestone =
    milestoneFilter != null ? milestones.find((m) => m.number === milestoneFilter) ?? null : null;

  const selectedItem = selected != null ? byNumber.get(selected) ?? null : null;

  // Métricas do nó selecionado (contagens de stories).
  const metrics = useMemo(() => {
    const scope = storiesUnder(selected);
    const planned = scope.filter((s) => s.milestone).length;
    return { total: scope.length, planned, backlog: scope.length - planned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stories, selected, byNumber]);

  // Stats por milestone (pontos), derivados da cópia de trabalho.
  const statsByMilestone = useMemo(() => {
    const map = new Map<number, MilestoneStats>();
    for (const m of milestones) {
      const assigned = stories.filter((s) => s.milestone?.number === m.number);
      const planned = assigned.reduce((sum, s) => sum + (s.points ?? 0), 0);
      const completed = assigned
        .filter(isDone)
        .reduce((sum, s) => sum + (s.points ?? 0), 0);
      map.set(m.number, {
        planned,
        completed,
        storyCount: assigned.length,
        pct: planned > 0 ? Math.round((completed / planned) * 100) : 0,
      });
    }
    return map;
  }, [milestones, stories]);

  const toggle = (n: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  // Atribuição otimista de milestone (drop ou dropdown).
  const assignMilestone = (storyNumber: number, milestoneNumber: number | null) => {
    const target =
      milestoneNumber != null ? milestones.find((m) => m.number === milestoneNumber) ?? null : null;
    const nextMilestone = target ? { number: target.number, title: target.title } : null;
    const prev = working;
    setWorking((items) =>
      items.map((it) => (it.number === storyNumber ? { ...it, milestone: nextMilestone } : it)),
    );
    setOpenMenu(null);
    setBusy(true);
    setStoryMilestone(repoId, storyNumber, milestoneNumber)
      .then(() => refresh())
      .catch((err: Error) => {
        setWorking(prev); // reverte a atualização otimista
        alert(err.message);
      })
      .finally(() => setBusy(false));
  };

  // ---- Drag-and-drop (id no state React, como no ProjectPage) ----
  const onRowDragStart = (e: DragEvent, storyNumber: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragged(storyNumber);
  };
  const onRowDragEnd = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const onZoneDragOver = (e: DragEvent, milestoneNumber: number) => {
    if (dragged == null) return;
    e.preventDefault();
    if (dropTarget !== milestoneNumber) setDropTarget(milestoneNumber);
  };
  const onZoneDrop = (e: DragEvent, milestoneNumber: number) => {
    e.preventDefault();
    const story = dragged;
    setDragged(null);
    setDropTarget(null);
    if (story != null) assignMilestone(story, milestoneNumber);
  };

  return (
    <div className="pl2">
      {/* Coluna 1 — Hierarquia */}
      <aside className="pl2-col pl2-col--tree">
        <div className="pl2-col__head">Hierarquia</div>
        <button
          type="button"
          className={`bl-tree__all${selected == null ? ' bl-tree__row--selected' : ''}`}
          onClick={() => setSelected(null)}
        >
          Todo o projeto
        </button>
        {roots.length === 0 ? (
          <p className="queue__empty">Sem Iniciativas/Épicos/Features.</p>
        ) : (
          <ul className="bl-tree">
            {roots.map((node) => (
              <TreeNode
                key={node.number}
                node={node}
                childrenMap={childrenMap}
                storyCountOf={(n) => storiesUnder(n).length}
                depth={0}
                selected={selected}
                onSelect={(n) => setSelected((cur) => (cur === n ? null : n))}
                collapsed={collapsed}
                onToggle={toggle}
              />
            ))}
          </ul>
        )}

        <div className="pl2-metrics">
          <div className="pl2-metrics__title">
            {selectedItem ? selectedItem.title : 'Todo o projeto'}
          </div>
          <div className="pl2-metrics__row">
            <span>Stories</span>
            <span className="mono">{metrics.total}</span>
          </div>
          <div className="pl2-metrics__row">
            <span>Planejadas</span>
            <span className="mono pl2-metrics__planned">{metrics.planned}</span>
          </div>
          <div className="pl2-metrics__row">
            <span>Backlog</span>
            <span className="mono pl2-metrics__backlog">{metrics.backlog}</span>
          </div>
        </div>
      </aside>

      {/* Coluna 2 — Story Backlog */}
      <section className="pl2-col pl2-col--stories">
        <div className="pl2-stories__head">
          <h2 className="pl2-stories__title">Story Backlog</h2>
          {selectedItem && (
            <span className="pl2-stories__filter">filtrado por {selectedItem.title}</span>
          )}
          <span className="pl2-stories__count">{visibleStories.length} stories</span>
        </div>

        {filterMilestone && (
          <div className="pl2-msbanner">
            <span>
              Planejando release: <strong>{filterMilestone.title}</strong>
            </span>
            <button
              type="button"
              className="pl2-msbanner__clear"
              onClick={() => setMilestoneFilter(null)}
              aria-label="Limpar filtro de milestone"
            >
              ✕
            </button>
          </div>
        )}

        <div className="pl2-table__head">
          <span>ID</span>
          <span>Título</span>
          <span>Prioridade</span>
          <span>Feature</span>
          <span>Milestone</span>
          <span />
        </div>

        <div className="pl2-rows">
          {visibleStories.length === 0 && <p className="queue__empty">Nenhuma story neste escopo.</p>}
          {visibleStories.map((story) => {
            const feature = ancestorOfType(story, byNumber, 'feature');
            return (
              <div
                key={story.number}
                className={`pl2-row${dragged === story.number ? ' pl2-row--dragging' : ''}`}
                draggable={!busy}
                onDragStart={(e) => onRowDragStart(e, story.number)}
                onDragEnd={onRowDragEnd}
              >
                <a
                  className="pl2-row__id"
                  href={hrefForItem(repoId, 'story', story.number)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <TypeBadge item={story} />
                  <span className="mono">#{story.number}</span>
                </a>
                <span className="pl2-row__title" title={story.title}>
                  {story.title}
                </span>
                <span className="pl2-row__prio">
                  {story.priority ? (
                    <span className={`chip chip--${story.priority.toLowerCase()}`}>
                      {story.priority}
                    </span>
                  ) : (
                    <span className="pl2-dim">—</span>
                  )}
                </span>
                <span className="pl2-row__feature" title={feature?.title}>
                  {feature ? feature.title : <span className="pl2-dim">—</span>}
                </span>
                <span className="pl2-row__ms">
                  <button
                    type="button"
                    className="pl2-pillbtn"
                    disabled={busy}
                    onClick={() =>
                      setOpenMenu((cur) =>
                        cur?.story === story.number && cur.kind === 'milestone'
                          ? null
                          : { story: story.number, kind: 'milestone' },
                      )
                    }
                  >
                    <span className={story.milestone ? '' : 'pl2-dim'}>
                      {story.milestone ? story.milestone.title : '—'}
                    </span>
                    <span className="pl2-caret">▾</span>
                  </button>
                  {openMenu?.story === story.number && openMenu.kind === 'milestone' && (
                    <div className="pl2-pop">
                      {milestones.map((m) => (
                        <button
                          key={m.number}
                          type="button"
                          className="pl2-pop__item"
                          onClick={() => assignMilestone(story.number, m.number)}
                        >
                          {m.title}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="pl2-pop__item pl2-pop__item--muted"
                        onClick={() => assignMilestone(story.number, null)}
                      >
                        Sem milestone
                      </button>
                    </div>
                  )}
                </span>
                <span className="pl2-row__actions">
                  <button
                    type="button"
                    className="pl2-iconbtn"
                    aria-label={`Ações de #${story.number}`}
                    onClick={() =>
                      setOpenMenu((cur) =>
                        cur?.story === story.number && cur.kind === 'actions'
                          ? null
                          : { story: story.number, kind: 'actions' },
                      )
                    }
                  >
                    ⋮
                  </button>
                  {openMenu?.story === story.number && openMenu.kind === 'actions' && (
                    <div className="pl2-pop pl2-pop--right">
                      <a className="pl2-pop__item" href={hrefForItem(repoId, 'story', story.number)}>
                        Editar
                      </a>
                      <button
                        type="button"
                        className="pl2-pop__item"
                        onClick={() => setOpenMenu({ story: story.number, kind: 'milestone' })}
                      >
                        Mover
                      </button>
                      <a className="pl2-pop__item" href={hrefForItem(repoId, 'story', story.number)}>
                        Abrir detalhes
                      </a>
                    </div>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        <div className="pl2-draghint">
          ⠿ Arraste uma story para um milestone à direita para planejá-la.
        </div>
      </section>

      {/* Coluna 3 — Milestones */}
      <aside className="pl2-col pl2-col--ms">
        <div className="pl2-col__head">
          Milestones
          <button
            type="button"
            className="pl2-col__action"
            onClick={() => setMsForm((v) => !v)}
          >
            + Novo
          </button>
        </div>
        {msForm && (
          <MilestoneForm
            repoId={repoId}
            onCancel={() => setMsForm(false)}
            onDone={() => {
              setMsForm(false);
              refresh();
            }}
          />
        )}
        {milestones.length === 0 && <p className="queue__empty">Nenhum milestone aberto.</p>}
        {milestones.map((m: MilestoneSummary) => {
          const s = statsByMilestone.get(m.number) ?? { planned: 0, completed: 0, storyCount: 0, pct: 0 };
          const eta = formatEta(m.dueOn);
          return (
            <div
              key={m.number}
              className={`pl2-mscard${dropTarget === m.number ? ' pl2-mscard--drop' : ''}`}
            >
              <div className="pl2-mscard__head">
                <span className="pl2-mscard__name">{m.title}</span>
                {eta && <span className="pl2-mscard__eta">ETA {eta}</span>}
              </div>
              <div className="pl2-mscard__bar">
                <div className="pl2-mscard__fill" style={{ width: `${s.pct}%` }} />
              </div>
              <div className="pl2-mscard__stats">
                <span className="mono">
                  {s.completed} / {s.planned} pts
                </span>
                <span>{s.storyCount} stories</span>
              </div>
              <div
                className="pl2-dropzone"
                onDragOver={(e) => onZoneDragOver(e, m.number)}
                onDragLeave={() => dropTarget === m.number && setDropTarget(null)}
                onDrop={(e) => onZoneDrop(e, m.number)}
              >
                Solte uma story aqui
              </div>
            </div>
          );
        })}
      </aside>
    </div>
  );
}
