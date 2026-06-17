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
  // Sub-issues (GitHub sub-issues / hierarquia). Para uma Feature, contém suas
  // Stories; cada Story contém suas Tasks. Folhas têm subIssues vazio/ausente.
  subIssues?: GhIssue[];
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
