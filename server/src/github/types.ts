// Formas "cruas" vindas da GitHub Issues API (REST/GraphQL).
// O adapter (adapter.ts) traduz estas formas para o modelo de domínio (types.ts).
//
// A estrutura segue o RFC-001: um Epic é uma issue [EPIC]; suas Features são
// issues [FEATURE] (sub-issues); cada Feature contém Stories e Tasks como
// sub-issues. O progresso de uma Feature deriva das Tasks fechadas.

export interface GhUser {
  login: string;
  name?: string | null;
}

export interface GhLabel {
  name: string;
}

export interface GhMilestone {
  title: string;
  dueOn?: string | null; // ISO
  createdAt?: string | null; // ISO
}

// Comentário de issue vindo do GraphQL (embutido na query da issue raiz).
export interface GhComment {
  body: string;
  createdAt: string; // ISO
  author: GhUser | null; // null p/ contas removidas (ghost)
}

// Issue genérica (qualquer nível da hierarquia).
export interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'OPEN' | 'CLOSED';
  url?: string;
  labels: GhLabel[];
  assignees: GhUser[];
  milestone?: GhMilestone | null;
  createdAt?: string | null;
  // Valor do campo "Status" (single-select) do GitHub Projects v2, quando a issue
  // está num Project — ex.: "Backlog Técnico", "Ready", "In Progress", "Done".
  // É a ÚNICA fonte do "em andamento": o `state` open/closed não distingue uma
  // task a fazer de uma em execução. `null` quando a issue não está num Project.
  projectStatus?: string | null;
  // Valor do campo "Etapa" (single-select) do board — a fase do kanban da issue,
  // ex.: "📥 Backlog", "🚧 Desenvolvimento", "👀 Code Review". Distinto do
  // "Status": a Etapa é a direção no board, o Status é o progresso dentro dela.
  // `null` quando a issue não está num Project ou não tem a Etapa definida.
  projectStage?: string | null;
  // Sub-issues (GitHub sub-issues / hierarquia). Para uma Feature, contém suas
  // Stories; cada Story contém suas Tasks. Folhas têm subIssues vazio/ausente.
  subIssues?: GhIssue[];
  // Comentários (só na issue raiz da query de work item; até os 50 mais
  // recentes, ordem cronológica). Ausente nas demais queries/níveis.
  comments?: GhComment[];
  // Total real de comentários da issue (pode exceder comments.length).
  commentsTotal?: number;
}

// Resposta consolidada que o adapter espera: o Epic + suas Features.
// (As Features já trazem suas sub-issues para o cálculo de progresso.)
export interface GhEpicPayload {
  epic: GhIssue;
  features: GhIssue[];
  // Time exibido no breadcrumb/hero. Pode vir de label `team:*`, milestone ou
  // ser informado explicitamente. Opcional — o adapter tem fallbacks.
  team?: string;
}

// --- Snapshot achatado do repositório (RFC-003, workspaces) ---

// PR que fecha uma issue (closedByPullRequestsReferences), forma crua.
export interface GhPullRequestRef {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  reviewDecision: string | null;
  reviewers: string[]; // logins (User) / nomes (Team) com review solicitado
  createdAt: string;
}

// Issue achatada da query de snapshot: sem subárvore — hierarquia via `parentNumber`
// e progresso via `subIssuesSummary` (agregado nativo do GitHub).
export interface GhSnapshotIssue {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  labels: string[];
  assignees: GhUser[];
  milestone: { number: number; title: string } | null;
  parentNumber: number | null;
  subIssuesSummary: { total: number; completed: number } | null;
  // Valores single-select do board: nome do CAMPO → nome da OPÇÃO (cru).
  projectFieldValues: Record<string, string>;
  prs: GhPullRequestRef[];
}

// Milestone do repositório (REST /milestones?state=all), forma crua relevante.
export interface GhMilestoneSummary {
  number: number;
  title: string;
  dueOn: string | null;
  state: 'open' | 'closed';
  openIssues: number;
  closedIssues: number;
  description: string | null;
}
