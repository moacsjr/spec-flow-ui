// Adapter: traduz issues do GitHub (forma crua) → WorkItemView (modelo das telas).
// A hierarquia RFC-001 é uniforme, então os três níveis reusam os mesmos helpers;
// só o conjunto de metadados, os rótulos e o tipo de filho (com/sem barra) variam.

import type { ChildItem, Crumb, Level, MetaField, Person, Status, WorkItemView } from '@spec-flow/shared';
import { avatarColor, initials } from '../lib/avatar.ts';
import { STATUS_LABELS, meanPct, statusFromPct } from '../lib/status.ts';
import { dateRange } from '../lib/date.ts';
import type { GhEpicPayload, GhIssue, GhUser } from './types.ts';

// Labels de tipo do RFC (config.mjs do spec-flow).
const TYPE_LABELS = ['[EPIC]', '[FEATURE]', '[STORY]', '[TASK]', '[BUG]', '[SPIKE]', '[RFC]'];

// Priority label (P0–P3) → rótulo legível (RFC seção 10).
const PRIORITY_TEXT: Record<string, string> = {
  P0: 'Crítica',
  P1: 'Alta',
  P2: 'Média',
  P3: 'Baixa',
};

export const AREA_NAMES = new Set(['Frontend', 'Backend', 'Mobile', 'Infra', 'DevOps', 'Data']);

function isClosed(issue: GhIssue): boolean {
  return String(issue.state).toUpperCase() === 'CLOSED';
}

// Status do campo "Status" do Projects v2 normalizado nos 3 estados do domínio.
// Issue fechada → done; senão lê `projectStatus` (rótulos PT/EN do board);
// ausente/desconhecido → todo. Base tanto do status da folha quanto do "Iniciar
// Desenvolvimento" da Story.
function boardStatus(issue: GhIssue): Status {
  if (isClosed(issue)) return 'done';
  const status = (issue.projectStatus ?? '').toLowerCase();
  if (/progress|andamento|doing|review|wip/.test(status)) return 'prog';
  if (/done|conclu/.test(status)) return 'done';
  return 'todo';
}

// Status de uma Task (folha). Diferente de Feature/Story, ela não tem progresso
// parcial: é binária no `state` (closed → done), mas o GitHub Projects v2 ainda
// expõe um terceiro estado, "Em andamento", no campo Status — que o open/closed
// não distingue de "A fazer". Por isso reusa o boardStatus.
function leafStatus(issue: GhIssue): Status {
  return boardStatus(issue);
}

// pct sintético da folha, coerente com seu status — só alimenta a legenda do
// painel (que conta por pct): em andamento → 50 (>0 e <100), feito → 100.
function leafPct(status: Status): number {
  return status === 'done' ? 100 : status === 'prog' ? 50 : 0;
}

// Remove o prefixo de tipo "[FEATURE] ", "[EPIC] " etc. do título.
function stripTypePrefix(title: string): string {
  return title.replace(/^\s*\[[A-Z]+\]\s*/, '').trim();
}

// Extrai o prefixo de tipo normalizado ("[FEATURE] ") de um título, ou '' se não
// houver. Usado na edição para reanexar o prefixo ao salvar (o título exibido é
// sempre o sem-prefixo de stripTypePrefix).
function typePrefixOf(title: string): string {
  const m = title.match(/^\s*(\[[A-Z]+\])\s*/);
  return m ? `${m[1]} ` : '';
}

function labelNames(issue: GhIssue): string[] {
  return (issue.labels || []).map((l) => l.name);
}

function priorityOf(issue: GhIssue): string {
  const p = labelNames(issue).find((n) => /^P[0-3]$/.test(n));
  return p ? PRIORITY_TEXT[p] : '—';
}

function areaOf(issue: GhIssue): string {
  return labelNames(issue).find((n) => AREA_NAMES.has(n)) || '—';
}

function releaseOf(issue: GhIssue): string {
  return labelNames(issue).find((n) => /^v\d/.test(n)) || '—';
}

function personFrom(user: GhUser | undefined, fallbackSeed: string): Person {
  const display = user?.name || user?.login || '';
  const seed = user?.login || display || fallbackSeed;
  return {
    name: display || '—',
    initials: initials(display || seed),
    avatarColor: avatarColor(seed),
  };
}

// Conta recursivamente as Tasks (folhas) sob um item e quantas estão fechadas.
// Se o item não tiver sub-issues, ele próprio conta como 1 task.
function countTasks(issue: GhIssue): { done: number; total: number } {
  const children = issue.subIssues || [];
  if (children.length === 0) {
    return { done: isClosed(issue) ? 1 : 0, total: 1 };
  }
  return children.reduce(
    (acc, child) => {
      const c = countTasks(child);
      acc.done += c.done;
      acc.total += c.total;
      return acc;
    },
    { done: 0, total: 0 },
  );
}

function pctFrom({ done, total }: { done: number; total: number }): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

// Tags exibidas no card: Area + Release (RFC seção 10), na ordem encontrada.
function tagsOf(issue: GhIssue): string[] {
  const names = labelNames(issue);
  const tags: string[] = [];
  for (const n of names) {
    if (AREA_NAMES.has(n)) tags.push(n);
    else if (/^v\d/.test(n)) tags.push(n); // Release (v1.0, v2.0…)
    else if (n.startsWith('tag:')) tags.push(n.slice(4));
  }
  return tags;
}

// Mapeia uma sub-issue para card. `leaf` → Task (binária, sem barra/contagem);
// caso contrário Feature/Story com progresso derivado das Tasks descendentes.
// `childLevel`, quando informado, gera o link de drill-down.
function toChild(issue: GhIssue, opts: { leaf?: boolean; childLevel?: Level } = {}): ChildItem {
  const assignee = personFrom(issue.assignees?.[0], `item-${issue.number}`);
  const base = {
    name: stripTypePrefix(issue.title),
    tags: tagsOf(issue),
    assignee: { initials: assignee.initials, avatarColor: assignee.avatarColor },
    // Coordenada de drill-down; o client converte em href (lib/router.hrefFor).
    to: opts.childLevel ? { level: opts.childLevel, number: issue.number } : undefined,
  };

  if (opts.leaf) {
    const status = leafStatus(issue);
    return { ...base, status, pct: leafPct(status), doneTasks: 0, totalTasks: 0, leaf: true };
  }

  const { done, total } = countTasks(issue);
  const pct = pctFrom({ done, total });
  return { ...base, status: statusFromPct(pct), pct, doneTasks: done, totalTasks: total, leaf: false };
}

// Time: label `team:*` → milestone → fallback informado.
function teamOf(issue: GhIssue, fallbackTeam?: string): string {
  const teamLabel = labelNames(issue).find((n) => n.startsWith('team:'));
  if (teamLabel) return teamLabel.slice(5).trim();
  if (fallbackTeam) return fallbackTeam;
  if (issue.milestone?.title) return issue.milestone.title;
  return '—';
}

// Acrônimo do time (3 letras), reusado por Epic/Feature/Story para o mesmo prefixo.
function teamPrefix(team: string): string {
  const word = team.replace(/squad/i, '').trim() || team;
  return (word.replace(/[^a-zA-Z]/g, '').slice(0, 3) || 'ITEM').toUpperCase();
}

// Código no estilo "CHK-204": prefixo do time + número da issue.
function codeOf(issue: GhIssue, team: string): string {
  return `${teamPrefix(team)}-${issue.number}`;
}

// Status do épico no hero: nome da coluna do Project (emoji removido) ou estado da issue.
function epicStatusText(epic: GhIssue, status?: string): string {
  if (status) return status.replace(/^[^\p{L}]+/u, '').trim();
  return isClosed(epic) ? 'Concluído' : 'Em andamento';
}

// Feature/Story não têm coluna de Project — status deriva do próprio progresso.
function statusTextFromPct(pct: number): string {
  return STATUS_LABELS[statusFromPct(pct)];
}

// Extrai o número da issue-pai a partir do corpo (spec-flow escreve
// "_Story pai: <url>_" / "_Feature pai: <url>_"). Best-effort para o modo live,
// onde um fetch de issue única não traz o pai pela API de sub-issues.
function parentFromBody(body: string | undefined): number | null {
  if (!body) return null;
  const m = body.match(/(?:pai|parent)[^#\n]*?#(\d+)/i) || body.match(/issues\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// Referência a um ancestral para montar o breadcrumb com link de subida.
export interface ParentRef {
  level: Level;
  number: number;
  code: string;
}

export interface AdaptContext {
  team?: string; // fallback de time (config/payload)
  parent?: ParentRef; // pai direto (feature→epic, story→feature)
  grandparent?: ParentRef; // avô (story→epic)
  spec?: string | null; // conteúdo do spec.md (Feature)
  plan?: string | null; // conteúdo do plan.md (Feature)
  status?: string; // coluna de Status do Project (Epic)
}

function crumbFor(ref: ParentRef): Crumb {
  return { label: ref.code, to: { level: ref.level, number: ref.number } };
}

// ----------------------------------------------------------------- Epic

export function adaptEpic(payload: GhEpicPayload, ctx: AdaptContext = {}): WorkItemView {
  const { epic } = payload;
  const team = teamOf(epic, ctx.team ?? payload.team);
  const owner = personFrom(epic.assignees?.[0], `epic-${epic.number}`);
  const children = (payload.features || []).map((f) => toChild(f, { childLevel: 'feature' }));

  const meta: MetaField[] = [
    { label: 'Prioridade', value: priorityOf(epic), kind: 'priority' },
    { label: 'Prazo', value: dateRange(epic.createdAt, epic.milestone?.dueOn) },
    { label: 'Responsável', value: owner.name, kind: 'person', person: owner },
    { label: 'Time', value: team },
  ];

  return {
    level: 'epic',
    code: codeOf(epic, team),
    title: stripTypePrefix(epic.title),
    status: epicStatusText(epic, ctx.status),
    owner,
    breadcrumb: [{ label: 'Épicos' }, { label: team }, { label: codeOf(epic, team) }],
    meta,
    descriptionMdx: epic.body || '',
    headerPct: meanPct(children), // regra da RFC: média dos % das features
    progressLabel: 'Progresso do épico',
    childrenLabel: 'Features',
    children,
  };
}

// --------------------------------------------------------------- Feature

export function adaptFeature(issue: GhIssue, ctx: AdaptContext = {}): WorkItemView {
  const team = teamOf(issue, ctx.team);
  const owner = personFrom(issue.assignees?.[0], `feat-${issue.number}`);
  const children = (issue.subIssues || []).map((s) => toChild(s, { childLevel: 'story' }));
  const pct = pctFrom(countTasks(issue)); // ponderado por tasks: bate com o card na Epic View

  const meta: MetaField[] = [
    { label: 'Prioridade', value: priorityOf(issue), kind: 'priority' },
    { label: 'Area', value: areaOf(issue) },
    { label: 'Release', value: releaseOf(issue) },
    { label: 'Responsável', value: owner.name, kind: 'person', person: owner },
  ];

  const breadcrumb: Crumb[] = [{ label: 'Épicos' }];
  if (ctx.parent) breadcrumb.push(crumbFor(ctx.parent));
  breadcrumb.push({ label: codeOf(issue, team) });

  return {
    level: 'feature',
    code: codeOf(issue, team),
    title: stripTypePrefix(issue.title),
    status: statusTextFromPct(pct),
    owner,
    breadcrumb,
    meta,
    descriptionMdx: issue.body || '',
    specMdx: ctx.spec ?? null,
    planMdx: ctx.plan ?? null,
    planApproved: labelNames(issue).includes('spec-wave:plan-approved'),
    headerPct: pct,
    progressLabel: 'Progresso da feature',
    childrenLabel: 'Stories',
    children,
  };
}

// ----------------------------------------------------------------- Story

export function adaptStory(issue: GhIssue, ctx: AdaptContext = {}): WorkItemView {
  const team = teamOf(issue, ctx.team);
  const owner = personFrom(issue.assignees?.[0], `story-${issue.number}`);
  const children = (issue.subIssues || []).map((t) => toChild(t, { leaf: true }));
  const pct = pctFrom(countTasks(issue));

  const meta: MetaField[] = [
    { label: 'Prioridade', value: priorityOf(issue), kind: 'priority' },
    { label: 'Responsável', value: owner.name, kind: 'person', person: owner },
  ];

  const breadcrumb: Crumb[] = [{ label: 'Épicos' }];
  if (ctx.grandparent) breadcrumb.push(crumbFor(ctx.grandparent));
  if (ctx.parent) breadcrumb.push(crumbFor(ctx.parent));
  breadcrumb.push({ label: codeOf(issue, team) });

  return {
    level: 'story',
    code: codeOf(issue, team),
    title: stripTypePrefix(issue.title),
    status: statusTextFromPct(pct),
    owner,
    breadcrumb,
    meta,
    descriptionMdx: issue.body || '',
    devStatus: boardStatus(issue),
    devAgentRequested: labelNames(issue).includes('spec-wave:dev-agent'),
    headerPct: pct,
    progressLabel: 'Progresso da story',
    childrenLabel: 'Tasks',
    children,
  };
}

export { TYPE_LABELS, teamOf, codeOf, parentFromBody, stripTypePrefix, typePrefixOf };
