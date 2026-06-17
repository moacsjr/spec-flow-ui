// Adapter: traduz issues do GitHub (forma crua) → modelo de domínio Epic/Feature.
// Toda a lógica de mapeamento RFC-001 → Epic View vive aqui.

import type { Epic, Feature, Person } from '../types';
import { avatarColor, initials } from '../lib/avatar';
import { statusFromPct } from '../lib/status';
import { dateRange } from '../lib/date';
import type { GhEpicPayload, GhIssue, GhUser } from './types';

// Labels de tipo do RFC (config.mjs do spec-flow).
const TYPE_LABELS = ['[EPIC]', '[FEATURE]', '[STORY]', '[TASK]', '[BUG]', '[SPIKE]', '[RFC]'];

// Priority label (P0–P3) → rótulo legível (RFC seção 10).
const PRIORITY_TEXT: Record<string, string> = {
  P0: 'Crítica',
  P1: 'Alta',
  P2: 'Média',
  P3: 'Baixa',
};

const AREA_NAMES = new Set(['Frontend', 'Backend', 'Mobile', 'Infra', 'DevOps', 'Data']);

function isClosed(issue: GhIssue): boolean {
  return String(issue.state).toUpperCase() === 'CLOSED';
}

// Remove o prefixo de tipo "[FEATURE] ", "[EPIC] " etc. do título.
function stripTypePrefix(title: string): string {
  return title.replace(/^\s*\[[A-Z]+\]\s*/, '').trim();
}

function labelNames(issue: GhIssue): string[] {
  return (issue.labels || []).map((l) => l.name);
}

function priorityOf(issue: GhIssue): string {
  const p = labelNames(issue).find((n) => /^P[0-3]$/.test(n));
  return p ? PRIORITY_TEXT[p] : '—';
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

// Conta recursivamente as Tasks (folhas) sob uma Feature e quantas estão fechadas.
// Se a Feature não tiver sub-issues, ela própria conta como 1 task.
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

function toFeature(issue: GhIssue): Feature {
  const { done, total } = countTasks(issue);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const assignee = personFrom(issue.assignees?.[0], `feat-${issue.number}`);
  return {
    name: stripTypePrefix(issue.title),
    status: statusFromPct(pct),
    pct,
    doneTasks: done,
    totalTasks: total,
    tags: tagsOf(issue),
    assignee: { initials: assignee.initials, avatarColor: assignee.avatarColor },
  };
}

// Time: label `team:*` → milestone → fallback informado no payload.
function teamOf(epic: GhIssue, payloadTeam?: string): string {
  const teamLabel = labelNames(epic).find((n) => n.startsWith('team:'));
  if (teamLabel) return teamLabel.slice(5).trim();
  if (payloadTeam) return payloadTeam;
  if (epic.milestone?.title) return epic.milestone.title;
  return '—';
}

// Código no estilo "CHK-204": acrônimo do time (3 letras) + número da issue.
function codeOf(epic: GhIssue, team: string): string {
  const word = team.replace(/squad/i, '').trim() || team;
  const prefix = (word.replace(/[^a-zA-Z]/g, '').slice(0, 3) || 'EPIC').toUpperCase();
  return `${prefix}-${epic.number}`;
}

// Status do épico no hero: usa o nome da coluna do Project (emoji removido) ou,
// na ausência, deriva do estado da issue.
function epicStatusText(epic: GhIssue, status?: string): string {
  if (status) return status.replace(/^[^\p{L}]+/u, '').trim();
  return isClosed(epic) ? 'Concluído' : 'Em andamento';
}

export interface AdaptOptions {
  // Nome da coluna de Status do GitHub Project, se disponível (ex.: "🚧 Desenvolvimento").
  status?: string;
}

export function adaptEpic(payload: GhEpicPayload, opts: AdaptOptions = {}): Epic {
  const { epic } = payload;
  const team = teamOf(epic, payload.team);
  const owner = personFrom(epic.assignees?.[0], `epic-${epic.number}`);

  return {
    code: codeOf(epic, team),
    title: stripTypePrefix(epic.title),
    team,
    status: epicStatusText(epic, opts.status),
    priority: priorityOf(epic),
    dates: dateRange(epic.createdAt, epic.milestone?.dueOn),
    owner,
    descriptionMdx: epic.body || '',
    features: (payload.features || []).map(toFeature),
  };
}

export { TYPE_LABELS };
