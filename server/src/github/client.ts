// Cliente GitHub GraphQL — busca um Epic e sua hierarquia de sub-issues.
//
// Usa a API de sub-issues do GitHub (feature `sub_issues`, header de preview).
// O épico é uma issue [EPIC]; suas Features são as sub-issues; cada Feature
// traz suas Stories, que trazem suas Tasks — o suficiente para o adapter
// calcular o progresso a partir das Tasks fechadas.

import type { GhEpicPayload, GhIssue } from './types.ts';
import { NotFoundError, UpstreamError } from '../lib/errors.ts';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number; // número da issue do Epic
  team?: string;
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

// 3 níveis de sub-issues: Feature → Story → Task.
const QUERY = `
query EpicView($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      ${ISSUE_FIELDS}
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
// Extrai o valor do campo single-select "Status" do(s) Project(s) v2 da issue.
// Valores de outros tipos de campo voltam como `{}` (não casaram o fragmento),
// então filtramos por `field.name === 'Status'`. Pega o primeiro que encontrar.
function projectStatusOf(node: any): string | null {
  for (const item of node.projectItems?.nodes ?? []) {
    for (const fv of item.fieldValues?.nodes ?? []) {
      if (fv?.field?.name === 'Status' && typeof fv.name === 'string') return fv.name;
    }
  }
  return null;
}

function normalize(node: any): GhIssue {
  return {
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

export async function fetchEpicPayload(config: GitHubConfig): Promise<GhEpicPayload> {
  const epic = await fetchIssueTree(config, config.issueNumber);
  const features = epic.subIssues ?? [];
  return { epic: { ...epic, subIssues: [] }, features, team: config.team };
}

// Lê um arquivo do repositório (Contents API, conteúdo cru). 404 → null.
// Usado para buscar `docs/features/<slug>/plan.md` na Feature View.
export async function fetchFileContent(config: GitHubConfig, path: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `bearer ${config.token}`,
      Accept: 'application/vnd.github.raw+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new UpstreamError(`GitHub Contents API ${res.status}: ${await res.text()}`);
  return res.text();
}
