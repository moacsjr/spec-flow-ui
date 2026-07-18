// Tela Specification do PM: versões/status do spec.md, triagem de comentários
// de revisão do Tech Leader e ações de aprovação/retorno.
//
// Convenções:
// - Histórico de versões É o histórico git do arquivo (v{n} = n-ésimo commit).
// - Comentário de revisão do TL = comentário da issue com o marcador
//   `<!-- spec-review -->` (opcionalmente com âncora JSON no marcador).
// - A triagem (aceitar/descartar) NÃO altera a issue — persiste no Dynamo;
//   a issue só muda com réplicas explícitas do PM.

import {
  createComment,
  fetchFileContent,
  fetchFileContentAtRef,
  fetchIssueCommentsFull,
  fetchIssueRef,
  fetchLatestWorkflowRun,
  listFileCommits,
  removeLabel,
  setIssueMilestone,
  type GhWorkflowRun,
  type GitHubConfig,
} from '../github/client.ts';
import {
  putSpecTriage,
  querySpecTriage,
  type SpecTriageState,
} from '../db/dynamo.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { resolveFeaturePaths, setStageForRepository } from './workItemService.ts';
import { triggerEstimate } from './estimateService.ts';

// Label aplicada pelo Tech Leader ao devolver uma spec (convenção compartilhada).
export const CHANGES_REQUESTED_LABEL = 'spec:changes-requested';
// Marcador dos comentários de revisão. Pode carregar uma âncora JSON:
//   <!-- spec-review {"headingPath":["..."],"startLine":1,...} -->
const REVIEW_MARKER_RE = /<!--\s*spec-review(\s+(\{[\s\S]*?\}))?\s*-->/;
// Workflow da geração inicial da spec (Action disparada pela label spec-wave:spec).
const SPEC_WORKFLOW_FILE = 'generate-spec.yml';

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

async function specPathOf(config: GitHubConfig, number: number): Promise<string> {
  const ref = await fetchIssueRef(config, number);
  const { specPath } = await resolveFeaturePaths(config, number, ref.title);
  return specPath;
}

// ---- Versões / conteúdo ----

export interface SpecMeta {
  path: string;
  content: string | null; // null = spec ainda não gerada
  sha: string | null; // commit sha da versão atual (versions[0])
  versions: { sha: string; message: string; committedAt: string }[];
}

export async function getSpecMeta(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<SpecMeta> {
  const config = await configFor(tenantId, repoId);
  const path = await specPathOf(config, number);
  const [content, commits] = await Promise.all([
    fetchFileContent(config, path),
    listFileCommits(config, path),
  ]);
  return {
    path,
    content,
    sha: commits[0]?.sha ?? null,
    versions: commits,
  };
}

export async function getSpecBlob(
  tenantId: string,
  repoId: string,
  number: number,
  sha: string,
): Promise<string> {
  const config = await configFor(tenantId, repoId);
  const path = await specPathOf(config, number);
  const content = await fetchFileContentAtRef(config, path, sha);
  if (content === null) {
    throw new HttpError(404, `spec.md não encontrada na revisão ${sha.slice(0, 7)}.`);
  }
  return content;
}

// ---- Status (Gerando/Erro — best-effort) ----

export interface SpecStatus {
  hasSpec: boolean;
  latestRun: GhWorkflowRun | null; // última execução do generate-spec.yml
}

export async function getSpecStatus(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<SpecStatus> {
  const config = await configFor(tenantId, repoId);
  const path = await specPathOf(config, number);
  const [content, latestRun] = await Promise.all([
    fetchFileContent(config, path),
    fetchLatestWorkflowRun(config, SPEC_WORKFLOW_FILE).catch(() => null),
  ]);
  return { hasSpec: content !== null, latestRun };
}

// ---- Comentários de revisão + triagem ----

export interface ReviewComment {
  id: number;
  author: string;
  createdAt: string;
  body: string; // corpo sem o marcador
  anchor: unknown | null; // âncora opcional embutida no marcador
  state: SpecTriageState;
  instruction: string | null; // instrução editada (default: corpo)
}

export async function listReviewComments(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<ReviewComment[]> {
  const config = await configFor(tenantId, repoId);
  const [comments, triage] = await Promise.all([
    fetchIssueCommentsFull(config, number),
    querySpecTriage(tenantId, repoId, number),
  ]);
  const triageById = new Map(triage.map((t) => [t.commentId, t]));

  return comments
    .filter((c) => REVIEW_MARKER_RE.test(c.body))
    .map((c) => {
      const match = c.body.match(REVIEW_MARKER_RE);
      let anchor: unknown | null = null;
      if (match?.[2]) {
        try {
          anchor = JSON.parse(match[2]);
        } catch {
          anchor = null;
        }
      }
      const t = triageById.get(c.id);
      return {
        id: c.id,
        author: c.author,
        createdAt: c.createdAt,
        body: c.body.replace(REVIEW_MARKER_RE, '').trim(),
        anchor,
        state: t?.state ?? 'pending',
        instruction: t?.instruction ?? null,
      };
    });
}

export async function setReviewCommentTriage(
  tenantId: string,
  repoId: string,
  number: number,
  commentId: number,
  state: SpecTriageState,
  instruction?: string,
): Promise<void> {
  await putSpecTriage({
    tenantId,
    repoId,
    issueNumber: number,
    commentId,
    state,
    ...(instruction !== undefined ? { instruction } : {}),
    updatedAt: new Date().toISOString(),
  });
}

export async function replyToReviewComment(
  tenantId: string,
  repoId: string,
  number: number,
  body: string,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await createComment(config, number, body);
}

// ---- Aprovação / retorno ----

// Ato único da aprovação: milestone (null = sem milestone) + remove a label de
// devolução + move a Feature para a etapa Plan.
export async function approveSpec(
  tenantId: string,
  repoId: string,
  number: number,
  milestoneNumber: number | null,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await setIssueMilestone(config, number, milestoneNumber);
  await removeLabel(config, number, CHANGES_REQUESTED_LABEL);
  await setStageForRepository(tenantId, repoId, number, 'Plan');
  // Enfileira a estimativa por IA da Feature (tela Planning). Fire-and-forget.
  triggerEstimate(tenantId, repoId, number);
  invalidateSnapshot(tenantId, repoId);
}

// Devolve a Feature à priorização (mantém prioridade/rank; o spec.md permanece).
export async function returnSpecToPrioritization(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  await setStageForRepository(tenantId, repoId, number, 'Priorizado');
  invalidateSnapshot(tenantId, repoId);
}
