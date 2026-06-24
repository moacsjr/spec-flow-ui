// Modelo de domínio das telas (Epic / Feature / Story View) — contrato de
// EXIBIÇÃO compartilhado entre server (que o produz) e client (que o renderiza).
// A hierarquia do spec-flow (RFC-001) é uniforme — Epic → Feature → Story → Task —
// então as três telas compartilham um único modelo: WorkItemView (o item da tela)
// com uma lista de ChildItem (os filhos exibidos como cards).
//
// Importante: este pacote é livre de DOM/roteamento. Links de drill-down são
// expressos como COORDENADAS de rota (`to: { level, number }`); o frontend é quem
// converte isso em href (lib/router.hrefFor) no render.

export type Status = 'done' | 'prog' | 'todo';

export type Level = 'epic' | 'feature' | 'story';

// Coordenada de navegação para um work item — o client a converte em href.
export interface RouteCoord {
  level: Level;
  number: number;
}

// Repositório conectado, exibido no Dashboard. Schema de GET /api/repositories.
export interface Repository {
  id: number;
  name: string;
  url: string;
  createdAt: string; // ISO 8601
}

// Resumo de um épico na lista de épicos de um repositório (issues com label
// [EPIC]). Leve — sem subárvore/progresso. Schema de GET /api/repositories/:id/epics.
export interface EpicSummary {
  number: number;
  title: string;
  code: string; // ex.: "CHK-204"
  state: 'open' | 'closed';
  url: string; // link da issue no GitHub
}

export interface RepositoryEpics {
  repository: Repository;
  epics: EpicSummary[];
}

export interface Person {
  name: string;
  initials: string;
  avatarColor: string; // CSS var, ex.: 'var(--av-blue)'
}

// Filho exibido como card no painel direito. Features e Stories têm progresso
// próprio (barra); Tasks são folhas (leaf) — checkbox/status, sem barra.
export interface ChildItem {
  name: string;
  status: Status;
  pct: number; // 0–100 (progresso próprio)
  doneTasks: number;
  totalTasks: number;
  tags: string[];
  assignee: { initials: string; avatarColor: string };
  leaf?: boolean; // Task: renderiza checkbox/status, sem barra nem contagem
  to?: RouteCoord; // destino de drill-down (folhas não têm)
}

// Campo de metadado do hero. `kind` decide a renderização especial.
export interface MetaField {
  label: string;
  value: string;
  kind?: 'text' | 'priority' | 'person';
  person?: Person; // quando kind === 'person'
}

// Segmento do breadcrumb. Sem `to` = segmento atual (não clicável).
export interface Crumb {
  label: string;
  to?: RouteCoord;
}

// Modelo único renderizado por qualquer uma das três telas.
export interface WorkItemView {
  level: Level;
  code: string; // "CHK-204" / "CHK-210" / "CHK-211"
  title: string;
  status: string; // texto da pill do hero
  owner: Person;
  breadcrumb: Crumb[];
  meta: MetaField[];
  descriptionMdx: string; // Spec (corpo da issue)
  planMdx?: string | null; // só Feature; null/undefined = sem aba Plan
  headerPct: number; // % grande do painel de progresso
  progressLabel: string; // "Progresso do épico" / "da feature" / "da story"
  childrenLabel: string; // "Features" | "Stories" | "Tasks"
  children: ChildItem[];
}
