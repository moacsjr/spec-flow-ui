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
// `id` é um ULID (string) gerado pelo servidor — escopado ao tenant dono.
export interface Repository {
  id: string;
  name: string;
  url: string;
  createdAt: string; // ISO 8601
  projectUrl?: string | null; // Projects v2 vinculado (para mover etapas); null = não configurado
  wipThreshold?: number | null; // WIP pessoal persuasivo do workspace Dev; null = default (2)
  slackConfigured?: boolean; // discussão integrada: bot do Slack configurado (token nunca exposto)
}

// Criação de um repositório conectado. POST /api/repositories.
// `projectUrl` é opcional: quando informado, o servidor introspecta o Projects v2
// (campo de etapa + opções) para permitir mover a Feature pela UI.
export interface CreateRepositoryRequest {
  url: string;
  projectUrl?: string;
}

// Edição de um repositório. PATCH /api/repositories/:id. Campos omitidos são
// mantidos; `projectUrl: ''` (vazio) desvincula o Projects v2.
export interface UpdateRepositoryRequest {
  url?: string;
  projectUrl?: string;
  wipThreshold?: number | null; // limiar do WIP persuasivo do dev (null = volta ao default 2)
  slackBotToken?: string; // write-only: bot token do Slack ('' remove a integração)
}

// Criação de uma Feature sob um Épico. POST /api/repositories/:id/workitems/epic/:number/features.
// O servidor cria a issue [FEATURE] (label + prefixo no título), a vincula como
// sub-issue do épico e — best-effort — a adiciona ao Projects v2 (Etapa = Backlog,
// Work Item Type = Feature, Prioridade/Área). `priority` ∈ P0–P3; `area` ∈ áreas
// do RFC (Frontend, Backend, …). Ambos viram label da issue + campo do board.
export interface CreateFeatureRequest {
  title: string;
  descriptionMdx?: string; // corpo da issue (opcional)
  priority?: string; // 'P0' | 'P1' | 'P2' | 'P3'
  area?: string; // 'Frontend' | 'Backend' | 'Mobile' | 'Infra' | 'DevOps' | 'Data'
}

// Tipos de work item que a tela Project do PM permite criar (espelha o
// `spec-wave issue --type`). A hierarquia natural é Initiative → Epic → Feature
// → Story → Task; Bug/Spike entram em qualquer ponto via parentNumber.
export type WorkItemType =
  | 'initiative'
  | 'epic'
  | 'feature'
  | 'story'
  | 'task'
  | 'bug'
  | 'spike';
export const WORK_ITEM_TYPES: WorkItemType[] = [
  'initiative',
  'epic',
  'feature',
  'story',
  'task',
  'bug',
  'spike',
];

// Posição na hierarquia (Initiative → Epic → Feature → Story → Task). Bug e
// Spike são folhas flexíveis (mesmo rank de Task): podem ser filhos de qualquer
// nível acima, nunca pais de itens da cadeia.
export const WORK_ITEM_RANK: Record<WorkItemType, number> = {
  initiative: 0,
  epic: 1,
  feature: 2,
  story: 3,
  task: 4,
  bug: 4,
  spike: 4,
};

// Regra de reparent: um item só pode ser filho de um tipo estritamente acima
// dele na hierarquia (rank do pai < rank do filho). Ex.: Task não pode ter
// Story como filha; Epic não pode ter Initiative como filha.
export function isAllowedParent(parentType: WorkItemType, childType: WorkItemType): boolean {
  return WORK_ITEM_RANK[parentType] < WORK_ITEM_RANK[childType];
}

// POST /api/repositories/:id/reparent — define o pai (sub-issue nativa) de um item.
export interface ReparentRequest {
  childNumber: number;
  parentNumber: number;
}

// POST /api/repositories/:id/reorder — grava a ordem de exibição custom (lista
// global de números de issue) do repositório.
export interface ReorderRequest {
  order: number[];
}

// Refino assíncrono (job + polling). POST .../refine devolve 202 { jobId }; o
// client faz polling em GET .../refine/:jobId até status !== 'pending'.
export type RefineJobStatus = 'pending' | 'done' | 'error';
export interface RefineEnqueueResponse {
  jobId: string;
}
export interface RefineJobResponse {
  status: RefineJobStatus;
  content?: string; // presente quando status === 'done'
  error?: string; // presente quando status === 'error'
}

// POST /api/repositories/:id/workitems — cria um work item de qualquer tipo,
// opcionalmente como sub-issue de `parentNumber`, e o adiciona ao board.
export interface CreateWorkItemRequest {
  type: WorkItemType;
  title: string;
  descriptionMdx?: string;
  priority?: string; // P0–P3
  area?: string; // Frontend | Backend | Mobile | Infra | DevOps | Data
  parentNumber?: number; // pai (sub-issue nativa); ausente/null = raiz
}
export interface CreatedWorkItem {
  number: number;
  url: string;
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
  descriptionMdx: string; // Feature (corpo da issue)
  specMdx?: string | null; // só Feature: docs/features/<slug>/spec.md; null = sem aba Spec
  planMdx?: string | null; // só Feature: docs/features/<slug>/plan.md; null = sem aba Plan
  planApproved?: boolean; // só Feature: true se label spec-wave:plan-approved presente
  devStatus?: Status; // só Story: status do board normalizado (todo/prog/done)
  devAgentRequested?: boolean; // só Story: true se label spec-wave:dev-agent presente
  devStage?: string | null; // só Story: nome da etapa do board ("Etapa"); a CTA de dev só aparece na etapa Desenvolvimento
  headerPct: number; // % grande do painel de progresso
  progressLabel: string; // "Progresso do épico" / "da feature" / "da story"
  childrenLabel: string; // "Features" | "Stories" | "Tasks"
  children: ChildItem[];
}

// Edição parcial de um work item (issue do GitHub). Campos espelham WorkItemView
// para o client falar um vocabulário só; o server mapeia descriptionMdx → body.
// PATCH /api/repositories/:id/workitems/:level/:number. Ao menos um campo.
export interface WorkItemPatch {
  title?: string; // novo título da issue
  descriptionMdx?: string; // novo corpo da issue (aba Feature)
}

// --- Geração/refino interativo de spec.md / plan.md (só Feature) ---
// O artefato é um arquivo `docs/features/<slug>/{spec,plan}.md` no repositório.
export type ArtifactKind = 'spec' | 'plan';

// POST .../workitems/feature/:number/:artifact/refine — registra o prompt como
// comentário na issue, envia o artefato atual + o prompt à LLM (OpenRouter) e
// devolve o texto gerado SEM salvar (o usuário decide salvar/descartar).
export interface ArtifactRefineRequest {
  prompt: string;
  // Base sobre a qual ajustar. Ausente → o servidor lê o arquivo atual do repo.
  // Presente → permite iterar sobre um rascunho ainda não salvo ("solicitar alteração").
  base?: string;
}
export interface ArtifactRefineResponse {
  content: string; // markdown gerado pela LLM
}

// POST .../workitems/feature/:number/:artifact/save — commita o conteúdo no
// arquivo (branch padrão) e devolve o WorkItemView recarregado.
export interface ArtifactSaveRequest {
  content: string;
}

// --- Workspaces por papel (RFC-003) ---
// O papel é um MODO DE VISUALIZAÇÃO do client (switcher, localStorage) — não é
// permissão. Não confundir com o role owner/member do tenant (billing).
export type WorkspaceRole = 'pm' | 'tech' | 'dev';

// Etapas canônicas do pipeline (RFC-003). No GitHub elas são opções do campo
// single-select "Etapa" do Projects v2 (nomes crus, com emoji); o server
// normaliza o nome cru para este enum ao montar o snapshot.
export type StageName =
  | 'Backlog'
  | 'Priorizado'
  | 'Spec'
  | 'Plan'
  | 'Ready'
  | 'Development'
  | 'Code Review'
  | 'QA'
  | 'UAT'
  | 'Done';

export const STAGE_NAMES: StageName[] = [
  'Backlog',
  'Priorizado',
  'Spec',
  'Plan',
  'Ready',
  'Development',
  'Code Review',
  'QA',
  'UAT',
  'Done',
];

// Prioridade = label P0–P3 da issue (fonte de verdade no GitHub).
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export const PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];

// Milestone do GitHub (REST), com contagem de issues para os widgets.
export interface MilestoneSummary {
  number: number;
  title: string;
  dueOn: string | null; // ISO
  state: 'open' | 'closed';
  openCount: number;
  closedCount: number;
  description: string | null; // corpo do milestone; guarda metadados (início/capacidade) do planner
}

// PR vinculado a uma issue via closing reference ("closes #n").
export interface PullRequestRef {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  // GitHub PullRequestReviewDecision: APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
  reviewDecision: string | null;
  reviewers: string[]; // logins/nomes com review solicitado
  createdAt: string; // ISO
}

// Item achatado do snapshot — uma issue do repositório com os campos que as
// páginas de workspace filtram/agrupam. `level` é inferido (labels de tipo +
// cadeia de pais); sem inferência possível → 'unknown'.
export interface SnapshotItem {
  number: number;
  title: string; // sem prefixo de tipo
  url: string;
  state: 'open' | 'closed';
  level: Level | 'task' | 'unknown';
  labels: string[];
  priority: Priority | null;
  area: string | null;
  stage: StageName | null; // normalizado; null = fora do board e issue aberta
  stageRaw: string | null; // nome cru da opção no board (ex.: "📋 Spec")
  points: number | null; // campo "Story Points" do Project (single-select); null = sem estimativa
  rank: number | null; // campo numérico "Rank" do Project (ordem da Prioritization); null = sem rank
  estimate: number | null; // campo numérico "Estimate" do Project (estimativa por IA/manual); null = sem estimativa
  milestone: { number: number; title: string } | null;
  assignees: { login: string; name: string | null }[];
  parentNumber: number | null;
  createdAt: string; // ISO
  closedAt: string | null; // ISO; null = aberta (métrica de entregas D4 do Dashboard)
  progress: { total: number; completed: number } | null; // subIssuesSummary
  prs: PullRequestRef[];
}

// Payload agregado de GET /api/repositories/:id/snapshot — uma leitura única do
// repositório que alimenta todas as páginas de workspace (filtros client-side).
export interface ProjectSnapshot {
  repository: Repository;
  generatedAt: string; // ISO
  milestones: MilestoneSummary[];
  items: SnapshotItem[];
  // Ordem de exibição custom (números de issue), persistida por tenant/repo. A
  // árvore da tela Project ordena por este índice; itens ausentes caem para o
  // fim (por número). Vazio = sem ordem custom (comportamento default).
  displayOrder: number[];
}
