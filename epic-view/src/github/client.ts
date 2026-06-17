// Cliente GitHub GraphQL — busca um Epic e sua hierarquia de sub-issues.
//
// Usa a API de sub-issues do GitHub (feature `sub_issues`, header de preview).
// O épico é uma issue [EPIC]; suas Features são as sub-issues; cada Feature
// traz suas Stories, que trazem suas Tasks — o suficiente para o adapter
// calcular o progresso a partir das Tasks fechadas.

import type { GhEpicPayload, GhIssue } from './types';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number; // número da issue do Epic
  team?: string;
}

const ENDPOINT = 'https://api.github.com/graphql';

// Fragmento reutilizável para os campos básicos de uma issue.
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
              ${ISSUE_FIELDS}
              subIssues(first: 50) {
                nodes { ${ISSUE_FIELDS} }
              }
            }
          }
        }
      }
    }
  }
}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
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
    subIssues: (node.subIssues?.nodes ?? []).map(normalize),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function fetchEpicPayload(config: GitHubConfig): Promise<GhEpicPayload> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${config.token}`,
      'Content-Type': 'application/json',
      'GraphQL-Features': 'sub_issues',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { owner: config.owner, repo: config.repo, number: config.issueNumber },
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((e: { message: string }) => e.message).join('; ')}`);
  }

  const issueNode = json.data?.repository?.issue;
  if (!issueNode) {
    throw new Error(`Issue #${config.issueNumber} não encontrada em ${config.owner}/${config.repo}.`);
  }

  const epic = normalize(issueNode);
  const features = epic.subIssues ?? [];
  return { epic: { ...epic, subIssues: [] }, features, team: config.team };
}

// Lê a configuração do GitHub a partir das variáveis de ambiente do Vite.
// Se ausente, retorna null e o app cai no fixture local.
export function configFromEnv(): GitHubConfig | null {
  const env = import.meta.env;
  const token = env.VITE_GITHUB_TOKEN;
  const repo = env.VITE_GITHUB_REPO; // "owner/repo"
  const issue = env.VITE_GITHUB_EPIC_ISSUE;
  if (!token || !repo || !issue) return null;
  const [owner, name] = String(repo).split('/');
  if (!owner || !name) return null;
  return {
    token: String(token),
    owner,
    repo: name,
    issueNumber: parseInt(String(issue), 10),
    team: env.VITE_GITHUB_TEAM ? String(env.VITE_GITHUB_TEAM) : undefined,
  };
}
