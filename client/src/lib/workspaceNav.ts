// Navegação dos workspaces por papel (RFC-003). Cada papel tem sua lista de
// páginas; o Dashboard é sempre a primeira (página inicial do papel). A UI só
// muda as PÁGINAS disponíveis — os dados do projeto são os mesmos.

import type { WorkspaceRole } from '@spec-flow/shared';

export interface WorkspaceNavItem {
  page: string; // segmento da URL (#/ws/:role/:page)
  label: string;
  icon: string; // emoji simples (sem lib de ícones no projeto)
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  pm: 'Product Manager',
  tech: 'Tech Leader',
  dev: 'Developer',
};

export const WORKSPACE_NAV: Record<WorkspaceRole, WorkspaceNavItem[]> = {
  pm: [
    { page: 'dashboard', label: 'Dashboard', icon: '📊' },
    { page: 'project', label: 'Project', icon: '🗂️' },
    { page: 'backlog', label: 'Backlog', icon: '📥' },
    { page: 'prioritization', label: 'Prioritization', icon: '🎯' },
    { page: 'specification', label: 'Specification', icon: '📄' },
    { page: 'planning', label: 'Planning', icon: '🗓️' },
    { page: 'milestones', label: 'Milestones', icon: '📅' },
    { page: 'homologation', label: 'Homologação', icon: '✅' },
    { page: 'progress', label: 'Progress', icon: '📈' },
  ],
  tech: [
    { page: 'dashboard', label: 'Dashboard', icon: '📊' },
    { page: 'specification', label: 'Specification', icon: '📄' },
    { page: 'technical-review', label: 'Technical Review', icon: '🔍' },
    { page: 'technical-backlog', label: 'Technical Backlog', icon: '🗂️' },
    { page: 'development', label: 'Development', icon: '💻' },
    { page: 'code-review', label: 'Code Review', icon: '🔀' },
    { page: 'qa', label: 'QA', icon: '🧪' },
    { page: 'uat', label: 'UAT', icon: '✅' },
    { page: 'progress', label: 'Progress', icon: '📈' },
  ],
  dev: [
    { page: 'dashboard', label: 'Dashboard', icon: '📊' },
    { page: 'pending', label: 'Pending', icon: '⏳' },
    { page: 'in-progress', label: 'In Progress', icon: '🚧' },
    { page: 'code-review', label: 'Code Review', icon: '🔀' },
    { page: 'qa', label: 'QA', icon: '🧪' },
    { page: 'progress', label: 'Progress', icon: '📈' },
  ],
};

// Página válida para o papel? (página desconhecida cai no dashboard)
export function isWorkspacePage(role: WorkspaceRole, page: string): boolean {
  return WORKSPACE_NAV[role].some((item) => item.page === page);
}
