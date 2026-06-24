// Serviço de work item — orquestra a busca no GitHub + adaptação para
// WorkItemView. Sempre live (sem fixture). A identidade do repo vem da config
// recebida (montada a partir da linha do SQLite); o token vive só no servidor.

import type { EpicSummary, Level, RepositoryEpics, WorkItemView } from '@spec-flow/shared';
import {
  fetchEpicPayload,
  fetchEpicSummaries,
  fetchFileContent,
  fetchIssueTree,
  type GitHubConfig,
} from '../github/client.ts';
import {
  adaptEpic,
  adaptFeature,
  adaptStory,
  codeOf,
  parentFromBody,
  stripTypePrefix,
  teamOf,
} from '../github/adapter.ts';
import type { AdaptContext } from '../github/adapter.ts';
import { slugify } from '../lib/slugify.ts';
import {
  configForRepository,
  getRepositoryOr404,
  toRepositoryDTO,
} from './repositoryService.ts';

// Carrega um work item a partir de uma config de repositório já resolvida.
export async function loadWorkItem(
  config: GitHubConfig,
  level: Level,
  number: number,
): Promise<WorkItemView> {
  if (level === 'epic') {
    return adaptEpic(await fetchEpicPayload({ ...config, issueNumber: number }), { team: config.team });
  }

  const issue = await fetchIssueTree(config, number);
  const ctx: AdaptContext = { team: config.team };

  // Pai (best-effort): o fetch de issue única não traz o pai pela API; tentamos
  // extrair do corpo (spec-flow escreve "_… pai: <url>_"). Sem isso, o breadcrumb
  // do ancestral fica sem link (degradação graciosa).
  const parentNum = parentFromBody(issue.body);
  if (parentNum) {
    const parentLevel: Level = level === 'feature' ? 'epic' : 'feature';
    ctx.parent = { level: parentLevel, number: parentNum, code: `#${parentNum}` };
  }

  if (level === 'feature') {
    const slug = slugify(issue.title);
    ctx.plan = await fetchFileContent(config, `docs/features/${slug}/plan.md`).catch(() => null);
    return adaptFeature(issue, ctx);
  }
  return adaptStory(issue, ctx);
}

// Resolve o repositório pelo id (SQLite) e carrega o work item naquele repo.
export async function loadWorkItemForRepository(
  id: number,
  level: Level,
  number: number,
): Promise<WorkItemView> {
  const row = await getRepositoryOr404(id);
  return loadWorkItem(configForRepository(row), level, number);
}

// Lista os épicos (issues [EPIC]) de um repositório.
export async function loadEpicSummaries(id: number): Promise<RepositoryEpics> {
  const row = await getRepositoryOr404(id);
  const config = configForRepository(row);
  const issues = await fetchEpicSummaries(config);

  const epics: EpicSummary[] = issues.map((issue) => {
    const team = teamOf(issue, config.team);
    return {
      number: issue.number,
      title: stripTypePrefix(issue.title),
      code: codeOf(issue, team),
      state: String(issue.state).toUpperCase() === 'CLOSED' ? 'closed' : 'open',
      url: issue.url ?? '',
    };
  });

  return { repository: toRepositoryDTO(row), epics };
}
