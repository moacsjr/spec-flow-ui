// Cliente GitHub GraphQL — busca um Epic e sua hierarquia de sub-issues.
//
// Usa a API de sub-issues do GitHub (feature `sub_issues`, header de preview).
// O épico é uma issue [EPIC]; suas Features são as sub-issues; cada Feature
// traz suas Stories, que trazem suas Tasks — o suficiente para o adapter
// calcular o progresso a partir das Tasks fechadas.

import type {
  GhEpicPayload,
  GhIssue,
  GhMilestoneSummary,
  GhPullRequestRef,
  GhSnapshotIssue,
} from './types.ts';
import { HttpError, NotFoundError, UpstreamError } from '../lib/errors.ts';
import { cachedGet } from '../lib/githubCache.ts';

// Config do Projects v2 de um repositório (descoberta no cadastro e persistida no
// SQLite). Permite mover a Feature de etapa: `etapaFieldId` é o campo single-select
// das etapas e `stageOptions` mapeia o NOME da opção (cru, ex. "📋 Spec") → id.
export interface ProjectConfig {
  projectId: string; // node id do ProjectV2
  projectNumber: number;
  etapaFieldId: string; // id do campo single-select de etapa
  stageOptions: Record<string, string>; // nome da opção → optionId
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number; // número da issue do Epic
  team?: string;
  project?: ProjectConfig; // Projects v2 (opcional; ausente = sem mover etapa)
}

const ENDPOINT = 'https://api.github.com/graphql';

// Campos completos de uma issue — usados no item atual (nível 0) e nos seus
// filhos diretos (nível 1), que são os cards exibidos na tela.
const ISSUE_FIELDS = `
  number
  title
  body
  state
  url
  createdAt
  labels(first: 20) { nodes { name } }
  assignees(first: 5) { nodes { login name } }
  milestone { title dueOn createdAt }
  projectItems(first: 10) {
    nodes {
      fieldValues(first: 20) {
        nodes {
          ... on ProjectV2ItemFieldSingleSelectValue {
            name
            field { ... on ProjectV2SingleSelectField { name } }
          }
        }
      }
    }
  }
`;

// Campos enxutos para os níveis profundos (2+). Eles nunca são exibidos —
// só alimentam countTasks (adapter), que precisa apenas de `state` e da
// estrutura de sub-issues. Omitir labels/assignees aqui é essencial: o GraphQL
// do GitHub multiplica os limites das conexões aninhadas, e um `labels(first:20)`
// sob 3 níveis de `subIssues(first:50)` estouraria o teto de 500.000 nós
// (50³ × 20 = 2.500.000). Sem essas conexões, o pior caso cai para 50³ = 125.000.
const COUNT_FIELDS = `
  number
  state
`;

// Comentários — SÓ na issue raiz (nível 0). Ficam fora de ISSUE_FIELDS de
// propósito: incluí-los nas sub-issues multiplicaria o orçamento de nós do
// GraphQL sem uso (a tela só exibe os comentários do item atual). `last: 50`
// prioriza os mais recentes (em ordem cronológica); `totalCount` diz se a
// janela cobre todos (relevante p/ resolveFeaturePaths reusar os corpos).
const COMMENT_FIELDS = `
  comments(last: 50) {
    totalCount
    nodes {
      body
      createdAt
      author { login ... on User { name } }
    }
  }
`;

// 3 níveis de sub-issues: Feature → Story → Task.
const QUERY = `
query EpicView($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      ${ISSUE_FIELDS}
      ${COMMENT_FIELDS}
      subIssues(first: 50) {
        nodes {
          ${ISSUE_FIELDS}
          subIssues(first: 50) {
            nodes {
              ${COUNT_FIELDS}
              subIssues(first: 50) {
                nodes { ${COUNT_FIELDS} }
              }
            }
          }
        }
      }
    }
  }
}`;

// Lista de épicos de um repositório: issues com label "[EPIC]" (literal, com
// colchetes), abertas e fechadas, mais recentes primeiro. Campos enxutos +
// labels/milestone (para teamOf/codeOf). Sem sub-issues (lista barata).
const EPICS_QUERY = `
query RepoEpics($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    issues(
      first: 50
      labels: ["[EPIC]"]
      states: [OPEN, CLOSED]
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {
        number
        title
        state
        url
        labels(first: 20) { nodes { name } }
        milestone { title }
      }
    }
  }
}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Valor do campo single-select "Status" (Todo/In Progress/Done) do board.
function projectStatusOf(node: any): string | null {
  return projectFieldOf(node, 'Status');
}

// Valor do campo "Etapa" (single-select do board) — a fase do kanban da issue.
function projectStageOf(node: any): string | null {
  return projectFieldOf(node, 'Etapa');
}

// Extrai o valor do primeiro campo single-select com o `name` dado nos
// Project(s) v2 da issue. Valores de outros tipos de campo voltam como `{}`
// (não casaram o fragmento), então filtramos por `field.name`.
function projectFieldOf(node: any, fieldName: string): string | null {
  for (const item of node.projectItems?.nodes ?? []) {
    for (const fv of item.fieldValues?.nodes ?? []) {
      if (fv?.field?.name === fieldName && typeof fv.name === 'string') return fv.name;
    }
  }
  return null;
}

function normalize(node: any): GhIssue {
  // Comentários só existem na issue raiz da query de work item; nas demais o
  // campo fica ausente (undefined) — o adapter trata como lista vazia.
  const comments = node.comments
    ? {
        comments: (node.comments.nodes ?? []).map((c: any) => ({
          body: c.body ?? '',
          createdAt: c.createdAt ?? '',
          author: c.author ? { login: c.author.login, name: c.author.name ?? null } : null,
        })),
        commentsTotal: node.comments.totalCount ?? 0,
      }
    : {};
  return {
    ...comments,
    number: node.number,
    title: node.title,
    body: node.body ?? '',
    state: node.state,
    url: node.url,
    createdAt: node.createdAt,
    labels: (node.labels?.nodes ?? []).map((l: any) => ({ name: l.name })),
    assignees: (node.assignees?.nodes ?? []).map((u: any) => ({ login: u.login, name: u.name })),
    milestone: node.milestone
      ? { title: node.milestone.title, dueOn: node.milestone.dueOn, createdAt: node.milestone.createdAt }
      : null,
    projectStatus: projectStatusOf(node),
    projectStage: projectStageOf(node),
    subIssues: (node.subIssues?.nodes ?? []).map(normalize),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Busca uma issue e sua subárvore (3 níveis de sub-issues) já normalizada.
export async function fetchIssueTree(config: GitHubConfig, number: number): Promise<GhIssue> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
      'GraphQL-Features': 'sub_issues',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { owner: config.owner, repo: config.repo, number },
    }),
  });

  if (!res.ok) {
    throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    errors?: { message: string; type?: string }[];
    data?: { repository?: { issue?: unknown } };
  };
  if (json.errors) {
    const msg = `GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`;
    // Issue inexistente volta como erro NOT_FOUND (não como data null) → 404.
    const notFound = json.errors.some(
      (e) => e.type === 'NOT_FOUND' || /could not resolve to an issue/i.test(e.message),
    );
    throw notFound ? new NotFoundError(msg) : new UpstreamError(msg);
  }

  const issueNode = json.data?.repository?.issue;
  if (!issueNode) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  return normalize(issueNode);
}

// Lista os épicos (issues [EPIC]) de um repositório, já normalizados (lean).
export async function fetchEpicSummaries(config: GitHubConfig): Promise<GhIssue[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: EPICS_QUERY,
      variables: { owner: config.owner, repo: config.repo },
    }),
  });

  if (!res.ok) {
    throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    errors?: { message: string; type?: string }[];
    data?: { repository?: { issues?: { nodes?: unknown[] } } | null };
  };
  if (json.errors) {
    const msg = `GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`;
    const notFound = json.errors.some(
      (e) => e.type === 'NOT_FOUND' || /could not resolve to a repository/i.test(e.message),
    );
    throw notFound ? new NotFoundError(msg) : new UpstreamError(msg);
  }

  const repo = json.data?.repository;
  if (!repo) {
    throw new NotFoundError(`Repositório ${config.owner}/${config.repo} não encontrado.`);
  }
  return (repo.issues?.nodes ?? []).map(normalize);
}

// --- Snapshot achatado do repositório (RFC-003, workspaces) ---

// Query paginada e FLAT: todas as issues do repo (abertas e fechadas), sem
// subárvore. Hierarquia via `parent` e progresso via `subIssuesSummary` (ambos
// da feature sub_issues); PRs via closing references — tudo numa query só.
// Orçamento de nós por página (100 issues): 100 × (20 labels + 5 assignees +
// 10×20 fieldValues + 10 PRs × 10 reviewRequests) ≈ 33.500 — folgado no teto.
const SNAPSHOT_QUERY = `
query RepoSnapshot($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(
      first: 100
      after: $cursor
      states: [OPEN, CLOSED]
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        url
        state
        createdAt
        closedAt
        labels(first: 20) { nodes { name } }
        assignees(first: 5) { nodes { login name } }
        milestone { number title }
        parent { number }
        subIssuesSummary { total completed }
        projectItems(first: 10) {
          nodes {
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2SingleSelectField { name } }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field { ... on ProjectV2Field { name } }
                }
              }
            }
          }
        }
        closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
          nodes {
            number
            title
            url
            state
            isDraft
            reviewDecision
            createdAt
            reviewRequests(first: 10) {
              nodes {
                requestedReviewer {
                  ... on User { login }
                  ... on Team { name }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeSnapshotIssue(node: any): GhSnapshotIssue {
  // Todos os valores single-select E numéricos de todos os boards da issue:
  // campo → valor (números viram string; ex.: Rank). O snapshotService decide
  // qual campo é o de etapa (stageOptions do repo).
  const projectFieldValues: Record<string, string> = {};
  for (const item of node.projectItems?.nodes ?? []) {
    for (const fv of item.fieldValues?.nodes ?? []) {
      if (!fv?.field?.name || fv.field.name in projectFieldValues) continue;
      if (typeof fv.name === 'string') projectFieldValues[fv.field.name] = fv.name;
      else if (typeof fv.number === 'number') projectFieldValues[fv.field.name] = String(fv.number);
    }
  }

  const prs: GhPullRequestRef[] = (node.closedByPullRequestsReferences?.nodes ?? []).map(
    (pr: any) => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      isDraft: Boolean(pr.isDraft),
      reviewDecision: pr.reviewDecision ?? null,
      reviewers: (pr.reviewRequests?.nodes ?? [])
        .map((r: any) => r?.requestedReviewer?.login ?? r?.requestedReviewer?.name)
        .filter((v: unknown): v is string => typeof v === 'string'),
      createdAt: pr.createdAt,
    }),
  );

  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    createdAt: node.createdAt,
    closedAt: node.closedAt ?? null,
    labels: (node.labels?.nodes ?? []).map((l: any) => l.name),
    assignees: (node.assignees?.nodes ?? []).map((u: any) => ({ login: u.login, name: u.name })),
    milestone: node.milestone
      ? { number: node.milestone.number, title: node.milestone.title }
      : null,
    parentNumber: node.parent?.number ?? null,
    subIssuesSummary: node.subIssuesSummary
      ? { total: node.subIssuesSummary.total ?? 0, completed: node.subIssuesSummary.completed ?? 0 }
      : null,
    projectFieldValues,
    prs,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Busca TODAS as issues do repositório (flat, paginado). `maxPages` limita o
// custo em repositórios muito grandes (10 páginas = 1.000 issues mais recentes).
export async function fetchRepoIssuesSnapshot(
  config: GitHubConfig,
  maxPages = 10,
): Promise<GhSnapshotIssue[]> {
  const issues: GhSnapshotIssue[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${config.token}`,
        'Content-Type': 'application/json',
        'GraphQL-Features': 'sub_issues',
      },
      body: JSON.stringify({
        query: SNAPSHOT_QUERY,
        variables: { owner: config.owner, repo: config.repo, cursor },
      }),
    });
    if (!res.ok) {
      throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as {
      errors?: { message: string; type?: string }[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data?: { repository?: { issues?: { pageInfo?: any; nodes?: unknown[] } } | null };
    };
    if (json.errors) {
      const msg = `GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`;
      const notFound = json.errors.some(
        (e) => e.type === 'NOT_FOUND' || /could not resolve to a repository/i.test(e.message),
      );
      throw notFound ? new NotFoundError(msg) : new UpstreamError(msg);
    }
    const repo = json.data?.repository;
    if (!repo) {
      throw new NotFoundError(`Repositório ${config.owner}/${config.repo} não encontrado.`);
    }

    issues.push(...(repo.issues?.nodes ?? []).map(normalizeSnapshotIssue));

    const pageInfo = repo.issues?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return issues;
}

// Lista os milestones do repositório (REST — o GraphQL não expõe contagens
// abertas/fechadas de forma tão direta). Inclui abertos e fechados.
export async function listMilestones(config: GitHubConfig): Promise<GhMilestoneSummary[]> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/milestones?state=all&per_page=100`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) {
    throw new NotFoundError(`Repositório ${config.owner}/${config.repo} não encontrado.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Milestones API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as Array<{
    number?: number;
    title?: string;
    due_on?: string | null;
    state?: string;
    open_issues?: number;
    closed_issues?: number;
    description?: string | null;
  }>;
  return json.map((m) => ({
    number: m.number ?? 0,
    title: m.title ?? '',
    dueOn: m.due_on ?? null,
    state: m.state === 'closed' ? 'closed' : 'open',
    openIssues: m.open_issues ?? 0,
    closedIssues: m.closed_issues ?? 0,
    description: m.description ?? null,
  }));
}

export async function fetchEpicPayload(config: GitHubConfig): Promise<GhEpicPayload> {
  const epic = await fetchIssueTree(config, config.issueNumber);
  const features = epic.subIssues ?? [];
  return { epic: { ...epic, subIssues: [] }, features, team: config.team };
}

// Lê um arquivo do repositório (Contents API, conteúdo cru). 404 → null.
// Usado para buscar `docs/features/<slug>/plan.md` na Feature View.
export async function fetchFileContent(config: GitHubConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  // GET condicional (ETag): 304 não consome rate limit — ver lib/githubCache.ts.
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github.raw+json',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`GitHub Contents API ${res.status}: ${await res.text()}`);
  return res.text();
}

// Lê o título cru (com prefixo "[FEATURE]" etc.) de uma issue (REST GET leve).
// Usado na edição para reanexar o prefixo ao salvar um novo título.
export async function fetchIssueTitle(config: GitHubConfig, number: number): Promise<string> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as { title?: string };
  return json.title ?? '';
}

// Lê os corpos dos comentários de uma issue (REST). Usado para localizar a
// referência estável a `docs/features/<slug>/` que o spec-wave comenta ao gerar
// spec.md/plan.md — o slug ali é congelado na geração, sobrevivendo a
// renomeações do título. Limita a 100 comentários (1 página). 404 → [].
export async function fetchIssueComments(config: GitHubConfig, number: number): Promise<string[]> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}/comments?per_page=100`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as Array<{ body?: string }>;
  return json.map((c) => c.body ?? '');
}

// Comentário de issue com metadados (id/autor/data) — usado pela triagem de
// revisões da spec (tela Specification do PM). 404 → [].
export interface GhIssueComment {
  id: number;
  body: string;
  author: string;
  createdAt: string; // ISO
}

export async function fetchIssueCommentsFull(
  config: GitHubConfig,
  number: number,
): Promise<GhIssueComment[]> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}/comments?per_page=100`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as Array<{
    id?: number;
    body?: string;
    user?: { login?: string };
    created_at?: string;
  }>;
  return json
    .filter((c) => typeof c.id === 'number')
    .map((c) => ({
      id: c.id as number,
      body: c.body ?? '',
      author: c.user?.login ?? '—',
      createdAt: c.created_at ?? '',
    }));
}

// Histórico de commits de um arquivo (REST /commits?path=...), mais recente
// primeiro. É o histórico de versões do spec.md — v{n} = n-ésimo commit.
export interface GhFileCommit {
  sha: string;
  message: string;
  committedAt: string; // ISO
}

export async function listFileCommits(
  config: GitHubConfig,
  path: string,
  limit = 30,
): Promise<GhFileCommit[]> {
  const url =
    `https://api.github.com/repos/${config.owner}/${config.repo}/commits` +
    `?path=${encodeURIComponent(path)}&per_page=${limit}`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new UpstreamError(`GitHub Commits API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as Array<{
    sha?: string;
    commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } };
  }>;
  return json
    .filter((c) => typeof c.sha === 'string')
    .map((c) => ({
      sha: c.sha as string,
      message: (c.commit?.message ?? '').split('\n')[0],
      committedAt: c.commit?.committer?.date ?? c.commit?.author?.date ?? '',
    }));
}

// Lê um arquivo numa revisão específica (Contents API + ref). 404 → null.
// Usado pelo diff de versões da spec.
export async function fetchFileContentAtRef(
  config: GitHubConfig,
  path: string,
  ref: string,
): Promise<string | null> {
  const url =
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}` +
    `?ref=${encodeURIComponent(ref)}`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github.raw+json',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`GitHub Contents API ${res.status}: ${await res.text()}`);
  return res.text();
}

// Última execução de um workflow (Actions API). null = workflow inexistente ou
// sem execuções. Best-effort para o estado "Erro" da fila de Specification.
export interface GhWorkflowRun {
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | ...
  url: string;
  createdAt: string;
}

export async function fetchLatestWorkflowRun(
  config: GitHubConfig,
  workflowFile: string,
): Promise<GhWorkflowRun | null> {
  const url =
    `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/` +
    `${encodeURIComponent(workflowFile)}/runs?per_page=1`;
  const res = await cachedGet(url, {
    Authorization: `bearer ${config.token}`,
    Accept: 'application/vnd.github+json',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`GitHub Actions API ${res.status}: ${await res.text()}`);
  const json = JSON.parse(await res.text()) as {
    workflow_runs?: Array<{
      status?: string;
      conclusion?: string | null;
      html_url?: string;
      created_at?: string;
    }>;
  };
  const run = json.workflow_runs?.[0];
  if (!run) return null;
  return {
    status: run.status ?? '',
    conclusion: run.conclusion ?? null,
    url: run.html_url ?? '',
    createdAt: run.created_at ?? '',
  };
}

// Atualiza título/corpo de uma issue (REST PATCH). Só envia os campos presentes.
// O token precisa de escopo de escrita em issues; 403 de permissão vira
// UpstreamError com a mensagem do GitHub (visível no client). 404 → NotFound.
export async function updateIssue(
  config: GitHubConfig,
  number: number,
  patch: { title?: string; body?: string },
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// Cria uma issue (REST POST). `title` já vem com o prefixo de tipo ("[FEATURE] …")
// e `labels` com o label de tipo correspondente. Labels inexistentes são criados
// pelo próprio GitHub. Devolve o número e o node id (necessário para vincular a
// sub-issue e adicionar ao Projects v2). Requer token com escrita em issues.
export async function createIssue(
  config: GitHubConfig,
  input: { title: string; body: string; labels: string[] },
): Promise<{ number: number; nodeId: string }> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { number?: number; node_id?: string };
  if (typeof json.number !== 'number' || typeof json.node_id !== 'string') {
    throw new UpstreamError('GitHub Issues API: resposta de criação inesperada.');
  }
  return { number: json.number, nodeId: json.node_id };
}

// Lê o node id (global) e o título cru de uma issue (REST GET). O node id é
// necessário para a mutation de sub-issue; o título alimenta a referência ao pai
// no corpo da Feature criada. 404 → NotFound.
export async function fetchIssueRef(
  config: GitHubConfig,
  number: number,
): Promise<{ nodeId: string; title: string }> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { node_id?: string; title?: string };
  if (typeof json.node_id !== 'string') {
    throw new UpstreamError('GitHub Issues API: resposta inesperada (sem node_id).');
  }
  return { nodeId: json.node_id, title: json.title ?? '' };
}

// Cria a relação de sub-issue nativa do GitHub (pai → filho) via GraphQL. Ambos os
// argumentos são node ids de issue. Usa o preview `sub_issues` (mesmo header das
// queries da subárvore). É o que faz a Feature aparecer sob o Épico.
export async function addSubIssue(
  config: GitHubConfig,
  parentNodeId: string,
  childNodeId: string,
): Promise<void> {
  const query = `
    mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
      addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
        subIssue { id number }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
      'GraphQL-Features': 'sub_issues',
    },
    body: JSON.stringify({ query, variables: { issueId: parentNodeId, subIssueId: childNodeId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[] };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
}

// Reparent: define `parentNodeId` como pai de `childNodeId`, movendo-o do pai
// atual se já houver (replaceParent). O GitHub rejeita ciclos. Usado no
// drag-and-drop da árvore (tela Project).
export async function setSubIssueParent(
  config: GitHubConfig,
  parentNodeId: string,
  childNodeId: string,
): Promise<void> {
  const query = `
    mutation SetSubIssueParent($issueId: ID!, $subIssueId: ID!) {
      addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: true }) {
        subIssue { id number }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
      'GraphQL-Features': 'sub_issues',
    },
    body: JSON.stringify({ query, variables: { issueId: parentNodeId, subIssueId: childNodeId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[] };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
}

// Adiciona um label a uma issue (REST). Idempotente no GitHub (re-adicionar é
// no-op). Usado para disparar as Actions do spec-wave (spec-wave:spec/plan).
export async function addLabel(config: GitHubConfig, number: number, label: string): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}/labels`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ labels: [label] }),
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// Remove um label de uma issue (REST DELETE). Label ausente na issue (404 do
// endpoint de label) é tratado como no-op — remoção é idempotente para o caller.
// Usado no swap de prioridade (P0–P3).
export async function removeLabel(
  config: GitHubConfig,
  number: number,
  label: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}/labels/${encodeURIComponent(label)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return; // issue ou label inexistente → nada a remover
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// Abre/fecha uma issue (REST PATCH state). Usado pelo "Delete" do Backlog
// (RFC-003): apagar = fechar a issue (GitHub não deleta issues via API).
// Substitui os assignees de uma issue (REST PATCH; [] limpa). Usado no
// "Devolver para Ready" da view Development do TL.
export async function setIssueAssignees(
  config: GitHubConfig,
  number: number,
  assignees: string[],
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ assignees }),
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// O login é collaborator do repositório? (aviso não bloqueante ao conceder o
// papel Dev — não-collaborator não pode ser assignee de issues.)
export async function isRepoCollaborator(
  config: GitHubConfig,
  username: string,
): Promise<boolean> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/collaborators/${username}`;
  const res = await fetch(url, {
    headers: { Authorization: `bearer ${config.token}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  throw new UpstreamError(`GitHub Collaborators API ${res.status}: ${await res.text()}`);
}

export async function updateIssueState(
  config: GitHubConfig,
  number: number,
  state: 'open' | 'closed',
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state }),
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// Cria um milestone no repositório (REST). Título duplicado → 422 do GitHub
// (sobe como UpstreamError com a mensagem original).
export async function createMilestone(
  config: GitHubConfig,
  input: { title: string; dueOn?: string | null; description?: string },
): Promise<GhMilestoneSummary> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/milestones`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      ...(input.dueOn ? { due_on: input.dueOn } : {}),
      ...(input.description ? { description: input.description } : {}),
    }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub Milestones API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    number?: number;
    title?: string;
    due_on?: string | null;
    state?: string;
    open_issues?: number;
    closed_issues?: number;
    description?: string | null;
  };
  return {
    number: json.number ?? 0,
    title: json.title ?? '',
    dueOn: json.due_on ?? null,
    state: json.state === 'closed' ? 'closed' : 'open',
    openIssues: json.open_issues ?? 0,
    closedIssues: json.closed_issues ?? 0,
    description: json.description ?? null,
  };
}

// Edita um milestone (REST PATCH): título, data-alvo (null limpa), estado e/ou
// descrição (onde o planner guarda metadados de início/capacidade).
export async function updateMilestone(
  config: GitHubConfig,
  milestoneNumber: number,
  patch: { title?: string; dueOn?: string | null; state?: 'open' | 'closed'; description?: string },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.dueOn !== undefined) body.due_on = patch.dueOn;
  if (patch.state !== undefined) body.state = patch.state;
  if (patch.description !== undefined) body.description = patch.description;

  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/milestones/${milestoneNumber}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 404) {
    throw new NotFoundError(
      `Milestone #${milestoneNumber} não encontrado em ${config.owner}/${config.repo}.`,
    );
  }
  if (!res.ok) throw new UpstreamError(`GitHub Milestones API ${res.status}: ${await res.text()}`);
}

// Exclui um milestone (REST DELETE). As issues atribuídas ficam sem milestone.
export async function deleteMilestone(
  config: GitHubConfig,
  milestoneNumber: number,
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/milestones/${milestoneNumber}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) {
    throw new NotFoundError(
      `Milestone #${milestoneNumber} não encontrado em ${config.owner}/${config.repo}.`,
    );
  }
  if (!res.ok && res.status !== 204) {
    throw new UpstreamError(`GitHub Milestones API ${res.status}: ${await res.text()}`);
  }
}

// Atribui/remove o milestone de uma issue (REST PATCH; null desatribui). É o
// que sincroniza o Planning (RFC-003) com o campo Milestone do GitHub.
export async function setIssueMilestone(
  config: GitHubConfig,
  issueNumber: number,
  milestoneNumber: number | null,
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ milestone: milestoneNumber }),
  });
  if (res.status === 404) {
    throw new NotFoundError(
      `Issue #${issueNumber} não encontrada em ${config.owner}/${config.repo}.`,
    );
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
}

// Cria um comentário na issue (REST). Usado para registrar o prompt do usuário
// no ciclo de refino de spec/plan.
export async function createComment(
  config: GitHubConfig,
  number: number,
  body: string,
): Promise<number> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${number}/comments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (res.status === 404) {
    throw new NotFoundError(`Issue #${number} não encontrada em ${config.owner}/${config.repo}.`);
  }
  if (!res.ok) throw new UpstreamError(`GitHub Issues API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { id?: number };
  return json.id ?? 0;
}

// Lê o SHA atual de um arquivo (Contents API, metadados JSON). Necessário para
// ATUALIZAR um arquivo existente via PUT. Arquivo inexistente → null (criação).
async function fetchFileSha(config: GitHubConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`GitHub Contents API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { sha?: string };
  return json.sha ?? null;
}

// Cria/atualiza um arquivo no repositório (Contents API PUT) com commit direto na
// branch padrão. Resolve o SHA do arquivo atual quando existe (update). O conteúdo
// vai em base64. O token precisa de escopo de escrita em conteúdo (repo).
export async function putFileContent(
  config: GitHubConfig,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  const sha = await fetchFileSha(config, path);
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub Contents API ${res.status}: ${await res.text()}`);
}

// --- Projects v2 ---

// "https://github.com/orgs/<login>/projects/<n>" ou ".../users/<login>/projects/<n>"
// → { kind, login, number }. Aceita também o número cru (usa o owner do repo como
// login do tipo informado em `defaultKind`). Não parseável → null.
export function parseProjectUrl(
  value: string,
): { kind: 'org' | 'user'; login: string; number: number } | null {
  const m = value.match(/github\.com\/(orgs|users)\/([^/]+)\/projects\/(\d+)/i);
  if (!m) return null;
  const number = parseInt(m[3], 10);
  if (!Number.isFinite(number)) return null;
  return { kind: m[1].toLowerCase() === 'orgs' ? 'org' : 'user', login: m[2], number };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Introspecta um Projects v2: id do projeto + campo single-select de etapa
// ("Etapa", senão "Status") e suas opções (nome → id). Usado no cadastro do repo
// para persistir os ids necessários a `moveProjectStage`.
export async function fetchProjectFields(
  config: GitHubConfig,
  project: { kind: 'org' | 'user'; login: string; number: number },
): Promise<ProjectConfig> {
  const ownerField = project.kind === 'org' ? 'organization' : 'user';
  const query = `
    query ProjectFields($login: String!, $number: Int!) {
      ${ownerField}(login: $login) {
        projectV2(number: $number) {
          id
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login: project.login, number: project.number } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: Record<string, any>;
  };
  if (json.errors) {
    const messages = json.errors.map((e) => e.message).join('; ');
    // "Could not resolve to a ProjectV2" com token de instalação quase sempre é
    // limitação do GitHub: Apps só acessam Projects v2 de ORGANIZAÇÃO (permissão
    // organization_projects); projetos de conta pessoal ficam invisíveis.
    if (/Could not resolve to a ProjectV2/i.test(messages)) {
      throw new HttpError(
        422,
        project.kind === 'user'
          ? `O projeto #${project.number} pertence a uma conta pessoal — GitHub Apps só acessam Projects v2 de organização. Use um projeto de organização (github.com/orgs/...) ou conecte o repositório sem projeto.`
          : `Projects v2 #${project.number} de "${project.login}" inacessível — confirme que o GitHub App está instalado nessa organização e que a permissão de Projects foi aceita na instalação.`,
      );
    }
    throw new UpstreamError(`GitHub GraphQL: ${messages}`);
  }
  const proj = json.data?.[ownerField]?.projectV2;
  if (!proj?.id) {
    throw new NotFoundError(
      `Projects v2 #${project.number} não encontrado para ${project.kind} "${project.login}".`,
    );
  }

  const fields: any[] = proj.fields?.nodes ?? [];
  // Prefere o campo "Etapa"; cai para "Status"; senão o primeiro single-select com opções.
  const byName = (re: RegExp) => fields.find((f) => f?.name && re.test(f.name) && f.options);
  const etapa = byName(/etapa/i) ?? byName(/status/i) ?? fields.find((f) => f?.options);
  if (!etapa?.id) {
    throw new NotFoundError(
      `Projeto #${project.number} não tem um campo de etapa (single-select) como "Etapa"/"Status".`,
    );
  }

  const stageOptions: Record<string, string> = {};
  for (const opt of etapa.options ?? []) {
    if (opt?.name && opt?.id) stageOptions[opt.name] = opt.id;
  }

  return {
    projectId: proj.id,
    projectNumber: project.number,
    etapaFieldId: etapa.id,
    stageOptions,
  };
}

// Resolve o id do ProjectV2Item de uma issue dentro de um projeto específico
// (necessário para mutar o valor do campo). Ausente no projeto → null.
export async function fetchProjectItemId(
  config: GitHubConfig,
  number: number,
  projectId: string,
): Promise<string | null> {
  const query = `
    query ProjectItem($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          projectItems(first: 20) { nodes { id project { id } } }
        }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { owner: config.owner, repo: config.repo, number },
    }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[]; data?: Record<string, any> };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const items: any[] = json.data?.repository?.issue?.projectItems?.nodes ?? [];
  const match = items.find((it) => it?.project?.id === projectId);
  return match?.id ?? null;
}

// Adiciona uma issue (pelo node id do conteúdo) ao Projects v2. Devolve o id do
// item criado no board — necessário para depois setar os campos single-select.
export async function addProjectItem(
  config: GitHubConfig,
  projectId: string,
  contentId: string,
): Promise<string> {
  const query = `
    mutation AddItem($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId, contentId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[]; data?: Record<string, any> };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const itemId = json.data?.addProjectV2ItemById?.item?.id;
  if (typeof itemId !== 'string') {
    throw new UpstreamError('GitHub GraphQL: addProjectV2ItemById sem item id.');
  }
  return itemId;
}

// Resolve um campo single-select do Projects v2 pelo NOME (id + opções nome→id),
// para campos que não são persistidos no SQLite (Work Item Type, Priority, Area).
// Campo ausente → null (o caller trata como best-effort).
export async function fetchSingleSelectField(
  config: GitHubConfig,
  projectId: string,
  fieldName: string,
): Promise<{ id: string; options: Record<string, string> } | null> {
  const query = `
    query GetField($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField { id name options { id name } }
            }
          }
        }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[]; data?: Record<string, any> };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const nodes: any[] = json.data?.node?.fields?.nodes ?? [];
  const field = nodes.find((f) => f?.name === fieldName && f?.options);
  if (!field?.id) return null;
  const options: Record<string, string> = {};
  for (const opt of field.options ?? []) {
    if (opt?.name && opt?.id) options[opt.name] = opt.id;
  }
  return { id: field.id, options };
}

// Move a etapa (single-select) de um item do Projects v2 (mutation). `optionId`
// vem de `ProjectConfig.stageOptions`.
export async function moveProjectStage(
  config: GitHubConfig,
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  const query = `
    mutation MoveStage($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId, itemId, fieldId, optionId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[] };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
}

// ---- Campo numérico do Projects v2 (ex.: "Rank" do Backlog) ----

// Localiza um campo numérico pelo nome. null = não existe no project.
export async function fetchNumberField(
  config: GitHubConfig,
  projectId: string,
  fieldName: string,
): Promise<{ id: string } | null> {
  const query = `
    query GetNumberField($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes { ... on ProjectV2Field { id name dataType } }
          }
        }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: { node?: { fields?: { nodes?: { id?: string; name?: string; dataType?: string }[] } } };
  };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const nodes = json.data?.node?.fields?.nodes ?? [];
  const field = nodes.find((f) => f?.name === fieldName && f?.dataType === 'NUMBER');
  return field?.id ? { id: field.id } : null;
}

// Cria um campo numérico no project (usado na primeira gravação do Rank).
export async function createNumberField(
  config: GitHubConfig,
  projectId: string,
  fieldName: string,
): Promise<{ id: string }> {
  const query = `
    mutation CreateNumberField($projectId: ID!, $name: String!) {
      createProjectV2Field(input: { projectId: $projectId, dataType: NUMBER, name: $name }) {
        projectV2Field { ... on ProjectV2Field { id } }
      }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId, name: fieldName } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    errors?: { message: string }[];
    data?: { createProjectV2Field?: { projectV2Field?: { id?: string } } };
  };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
  const id = json.data?.createProjectV2Field?.projectV2Field?.id;
  if (!id) throw new UpstreamError('GitHub GraphQL: createProjectV2Field não retornou o id.');
  return { id };
}

// Grava um valor numérico num item do project (updateProjectV2ItemFieldValue).
export async function setProjectItemNumberValue(
  config: GitHubConfig,
  projectId: string,
  itemId: string,
  fieldId: string,
  value: number,
): Promise<void> {
  const query = `
    mutation SetNumberValue($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
        value: { number: $value }
      }) { projectV2Item { id } }
    }`;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { projectId, itemId, fieldId, value } }),
  });
  if (!res.ok) throw new UpstreamError(`GitHub API ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { errors?: { message: string }[] };
  if (json.errors) {
    throw new UpstreamError(`GitHub GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
