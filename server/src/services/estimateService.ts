// Estimativa de esforço da Feature em story points (tela Planning).
//
// O VALOR vive no campo numérico "Estimate" do Projects v2 (visível no GitHub,
// sem lock-in); a origem (ai|manual), a versão da spec usada e o marcador de
// spec desatualizada ficam no Dynamo (EstimateMetaRecord).
//
// Gatilhos:
// - aprovação da spec (view Specification) → estima por IA;
// - novo commit da spec com origem `ai` vigente → reestima;
// - origem `manual` → nunca reestima; só marca `stale` (a UI sinaliza).
//
// Nota (Lambda): os gatilhos disparam fire-and-forget no fluxo da request —
// suficiente no dev server; endurecer com worker dedicado é fase 2.

import {
  createNumberField,
  fetchFileContent,
  fetchIssueRef,
  fetchNumberField,
  fetchProjectItemId,
  listFileCommits,
  setProjectItemNumberValue,
  type GitHubConfig,
} from '../github/client.ts';
import {
  getEstimateMeta,
  putEstimateMeta,
  queryEstimateMeta,
  type EstimateMetaRecord,
} from '../db/dynamo.ts';
import { generateText } from '../llm/openrouter.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { resolveFeaturePaths } from './workItemService.ts';

const ESTIMATE_FIELD = 'Estimate';
const FIB = [1, 2, 3, 5, 8, 13, 21];
const MAX_SPEC_CHARS = 9000; // teto do prompt (custo/latência)

async function specOf(
  config: GitHubConfig,
  number: number,
): Promise<{ content: string | null; sha: string | null }> {
  const ref = await fetchIssueRef(config, number);
  const { specPath } = await resolveFeaturePaths(config, number, ref.title);
  const [content, commits] = await Promise.all([
    fetchFileContent(config, specPath),
    listFileCommits(config, specPath, 1),
  ]);
  return { content, sha: commits[0]?.sha ?? null };
}

async function writeEstimateField(
  config: GitHubConfig,
  number: number,
  points: number,
): Promise<void> {
  if (!config.project) throw new HttpError(409, 'Repositório sem Projects v2 vinculado.');
  const itemId = await fetchProjectItemId(config, number, config.project.projectId);
  if (!itemId) throw new HttpError(422, `A issue #${number} não está no board.`);
  const field =
    (await fetchNumberField(config, config.project.projectId, ESTIMATE_FIELD)) ??
    (await createNumberField(config, config.project.projectId, ESTIMATE_FIELD));
  await setProjectItemNumberValue(config, config.project.projectId, itemId, field.id, points);
}

// Estima por IA a partir do spec.md aprovado (escala Fibonacci). Grava o campo
// Estimate + metadados (origem ai). Silencioso quando não há spec.
export async function runEstimateForFeature(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, repoId));
  const { content, sha } = await specOf(config, number);
  if (!content) return; // sem spec — nada a estimar

  // Mesma política de cota do refine: tenant com chave própria não consome.
  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const answer = await generateText({
    system:
      'Você estima o esforço de implementação de features em story points na escala ' +
      `Fibonacci (${FIB.join(', ')}). Considere escopo, complexidade técnica e incertezas ` +
      'da especificação. Responda SOMENTE o número, sem texto adicional.',
    user: `## Especificação\n\n${content.slice(0, MAX_SPEC_CHARS)}`,
    apiKeyOverride: tenantKey,
    maxTokens: 8,
  });

  const parsed = Number.parseInt(answer.replace(/[^\d]/g, ''), 10);
  // Encaixa na escala (valor mais próximo) — protege contra saídas fora do padrão.
  const points = Number.isFinite(parsed)
    ? FIB.reduce((best, f) => (Math.abs(f - parsed) < Math.abs(best - parsed) ? f : best), FIB[0])
    : FIB[2];

  await writeEstimateField(config, number, points);
  await putEstimateMeta({
    tenantId,
    repoId,
    issueNumber: number,
    origin: 'ai',
    specSha: sha,
    stale: false,
    updatedAt: new Date().toISOString(),
  });
  invalidateSnapshot(tenantId, repoId);
}

// Gatilho fire-and-forget (aprovação da spec / re-estimativa). Nunca lança.
export function triggerEstimate(tenantId: string, repoId: string, number: number): void {
  runEstimateForFeature(tenantId, repoId, number).catch((err: Error) =>
    logger.warn(`Estimativa da feature #${number} falhou: ${err.message}`),
  );
}

// Novo commit da spec: origem ai → reestima; manual → marca stale (não sobrescreve).
export function onSpecSaved(tenantId: string, repoId: string, number: number): void {
  (async () => {
    const meta = await getEstimateMeta(tenantId, repoId, number);
    if (!meta) return; // ainda sem estimativa — a aprovação cuidará
    if (meta.origin === 'ai') {
      await runEstimateForFeature(tenantId, repoId, number);
    } else {
      await putEstimateMeta({ ...meta, stale: true, updatedAt: new Date().toISOString() });
    }
  })().catch((err: Error) =>
    logger.warn(`Pós-save da spec #${number}: atualização de estimativa falhou: ${err.message}`),
  );
}

// Override manual (edição inline no card): grava o campo + origem manual.
// Valores manuais não são sobrescritos por reestimativas automáticas.
export async function setManualEstimate(
  tenantId: string,
  repoId: string,
  number: number,
  points: number,
): Promise<void> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, repoId));
  await writeEstimateField(config, number, points);
  const { sha } = await specOf(config, number).catch(() => ({ sha: null }));
  await putEstimateMeta({
    tenantId,
    repoId,
    issueNumber: number,
    origin: 'manual',
    specSha: sha,
    stale: false,
    updatedAt: new Date().toISOString(),
  });
  invalidateSnapshot(tenantId, repoId);
}

// Metadados batch para a tela (origem + stale por feature).
export async function listEstimateMeta(
  tenantId: string,
  repoId: string,
): Promise<Pick<EstimateMetaRecord, 'issueNumber' | 'origin' | 'stale'>[]> {
  const list = await queryEstimateMeta(tenantId, repoId);
  return list.map((m) => ({ issueNumber: m.issueNumber, origin: m.origin, stale: m.stale }));
}
