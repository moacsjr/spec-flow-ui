// Modelo de dados da Epic View (RFC seção 5).

export type Status = 'done' | 'prog' | 'todo';

export interface Person {
  name: string;
  initials: string;
  avatarColor: string; // CSS var, ex.: 'var(--av-blue)'
}

export interface Feature {
  name: string;
  status: Status;
  pct: number; // 0–100 (progresso próprio)
  doneTasks: number;
  totalTasks: number;
  tags: string[];
  assignee: { initials: string; avatarColor: string };
}

export interface Epic {
  code: string; // "CHK-204"
  title: string;
  team: string; // "Squad Checkout"
  status: string; // "Em andamento"
  priority: string; // "Alta"
  dates: string; // "12 mai – 30 jun"
  owner: Person;
  descriptionMdx: string; // fonte MDX renderizada no painel de descrição
  features: Feature[];
}
