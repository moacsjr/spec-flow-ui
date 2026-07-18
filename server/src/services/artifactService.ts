// Serviço do ciclo interativo de spec.md / plan.md (só Feature):
//   create → aplica o label do spec-wave (dispara a Action que gera o arquivo) e
//            move a Feature para a etapa correspondente no Projects v2.
//   refine → registra o prompt como comentário, lê o artefato atual e pede à LLM
//            (OpenRouter) o texto ajustado — SEM salvar.
//   save   → commita o conteúdo em docs/features/<slug>/<artifact>.md (branch padrão).
//
// O artefato é um arquivo do repositório; a geração inicial fica a cargo da
// GitHub Action (decisão de produto). Aqui só orquestramos a transição e o refino.

import { randomUUID } from 'node:crypto';
import type { ArtifactKind, WorkItemView } from '@spec-flow/shared';
import {
  addLabel,
  createComment,
  fetchFileContent,
  fetchIssueTitle,
  fetchProjectItemId,
  moveProjectStage,
  putFileContent,
  type GitHubConfig,
} from '../github/client.ts';
import { generateArtifact } from '../llm/openrouter.ts';
import { logger } from '../lib/logger.ts';
import { emitMetric } from '../lib/metrics.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { getRefineJob, putRefineJob, putStageEntry, updateRefineJob } from '../db/dynamo.ts';
import { invokeAsync } from '../lib/lambdaInvoke.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { loadWorkItem, resolveFeaturePaths } from './workItemService.ts';

// Nome do label do spec-wave que dispara a Action de geração do artefato.
const LABEL: Record<ArtifactKind, string> = {
  spec: 'spec-wave:spec',
  plan: 'spec-wave:plan',
};

// Label que sinaliza que o plan.md foi aprovado e a Feature está pronta.
const READY_LABEL = 'spec-wave:ready';

// Label que dispara a decomposição da Feature em Stories e Tasks.
const DECOMPOSE_LABEL = 'spec-wave:decompose';

// Título da issue (para o slug de fallback). Best-effort — em falha devolve ''.
async function fetchTitleSafe(config: GitHubConfig, number: number): Promise<string> {
  try {
    return await fetchIssueTitle(config, number);
  } catch {
    return '';
  }
}

// Caminho do arquivo (spec.md / plan.md) resiliente a renomeações do título.
async function pathFor(config: GitHubConfig, number: number, kind: ArtifactKind): Promise<string> {
  const title = await fetchTitleSafe(config, number);
  const { specPath, planPath } = await resolveFeaturePaths(config, number, title);
  return kind === 'spec' ? specPath : planPath;
}

// Move a Feature para a etapa (📋 Spec / 📋 Plan) no Projects v2, se o repositório
// tiver projeto configurado e existir uma opção de etapa que case com o artefato.
// Best-effort: falha aqui não derruba o create (loga e segue).
async function moveStage(config: GitHubConfig, number: number, kind: ArtifactKind): Promise<void> {
  const project = config.project;
  if (!project) return; // repositório sem Projects v2 configurado
  const re = kind === 'spec' ? /spec/i : /plan/i;
  const entry = Object.entries(project.stageOptions).find(([name]) => re.test(name));
  if (!entry) {
    logger.warn(`Projeto ${config.owner}/${config.repo} sem opção de etapa para "${kind}".`);
    return;
  }
  const [, optionId] = entry;
  try {
    const itemId = await fetchProjectItemId(config, number, project.projectId);
    if (!itemId) {
      logger.warn(`Issue #${number} não está no Projects v2 ${project.projectId}.`);
      return;
    }
    await moveProjectStage(config, project.projectId, itemId, project.etapaFieldId, optionId);
  } catch (err) {
    logger.warn(`Falha ao mover etapa da issue #${number}: ${(err as Error).message}`);
  }
}

// create: aplica o label (dispara a Action) e move a etapa. Devolve o
// WorkItemView recarregado (o arquivo ainda não existe; o client faz o poll).
export async function createArtifact(
  tenantId: string,
  id: string,
  number: number,
  kind: ArtifactKind,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  await addLabel(config, number, LABEL[kind]);
  await moveStage(config, number, kind);
  // Registra a entrada na etapa (tempo-na-etapa das telas do PM). Best-effort.
  putStageEntry({
    tenantId,
    repoId: id,
    stage: kind === 'spec' ? 'Spec' : 'Plan',
    issueNumber: number,
    at: new Date().toISOString(),
    approximate: false,
  }).catch(() => undefined);
  invalidateSnapshot(tenantId, id); // label + etapa mudaram → workspaces releem
  return loadWorkItem(config, 'feature', number);
}

// approvePlan: aplica o label de aprovação (spec-wave:ready) na Feature e devolve
// o WorkItemView recarregado. Idempotente (addLabel não duplica). Pré-condição de
// existência do plan.md é checada na UI; aqui só aplicamos o label.
export async function approvePlan(
  tenantId: string,
  id: string,
  number: number,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  await addLabel(config, number, READY_LABEL);
  invalidateSnapshot(tenantId, id);
  return loadWorkItem(config, 'feature', number);
}

// decomposeFeature: aplica spec-wave:decompose para disparar a Action de decomposição.
export async function decomposeFeature(
  tenantId: string,
  id: string,
  number: number,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  await addLabel(config, number, DECOMPOSE_LABEL);
  invalidateSnapshot(tenantId, id);
  return loadWorkItem(config, 'feature', number);
}

// Payload do job de refino — passado ao worker Lambda (Event) ou usado inline
// no fallback de dev. Não carrega segredos (a chave é re-resolvida no worker).
export interface RefineJobPayload {
  tenantId: string;
  id: string;
  number: number;
  kind: ArtifactKind;
  prompt: string;
  base?: string;
  jobId: string;
}

// startRefine: valida, consome cota (429 síncrono) e cria o job pending; dispara
// o worker assíncrono (produção) ou roda inline (dev, sem worker). Devolve o
// jobId — o client faz polling em getRefineJobForTenant.
export async function startRefineJob(
  tenantId: string,
  id: string,
  number: number,
  kind: ArtifactKind,
  prompt: string,
  base?: string,
): Promise<{ jobId: string }> {
  await getRepositoryOr404(tenantId, id); // 404 se o repo não for do tenant

  // Cota (fase 3): consome 1 refine do mês ANTES de criar o job (429 imediato).
  // Tenant com chave OpenRouter própria não consome cota.
  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const jobId = randomUUID();
  await putRefineJob({
    tenantId,
    jobId,
    status: 'pending',
    kind,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + 3600, // 1h
  });

  const payload: RefineJobPayload = { tenantId, id, number, kind, prompt, base, jobId };
  const workerFn = process.env.REFINE_WORKER_FUNCTION_NAME;
  if (workerFn) {
    await invokeAsync(workerFn, payload); // produção: Lambda separada (sem teto de 29s)
  } else {
    await runRefineJob(payload); // dev/local: sem worker → roda inline
  }
  return { jobId };
}

// runRefine (corpo do worker): posta o comentário, lê o artefato atual (e a spec,
// no plan) e pede à LLM o texto ajustado; grava o resultado no job. NÃO consome
// cota (já consumida no enqueue) e NÃO lança — erros vão para o job (status=error).
export async function runRefineJob(payload: RefineJobPayload): Promise<void> {
  const { tenantId, id, number, kind, prompt, base, jobId } = payload;
  const startedAt = Date.now();
  try {
    const config = await configForRepository(await getRepositoryOr404(tenantId, id));
    const tenantKey = await tenantOpenrouterKey(tenantId);

    await createComment(config, number, `🛠️ **Refino de ${kind} (via UI)**\n\n${prompt}`);

    const title = await fetchTitleSafe(config, number);
    const { specPath, planPath } = await resolveFeaturePaths(config, number, title);
    const currentPath = kind === 'spec' ? specPath : planPath;

    // `base` (rascunho não salvo) tem precedência; senão lê o arquivo do repo.
    const currentContent =
      base !== undefined ? base : await fetchFileContent(config, currentPath).catch(() => null);
    const spec =
      kind === 'plan' ? await fetchFileContent(config, specPath).catch(() => null) : null;

    const content = await generateArtifact({
      kind,
      currentContent,
      userPrompt: prompt,
      spec,
      apiKeyOverride: tenantKey,
    });
    await updateRefineJob(tenantId, jobId, { status: 'done', content });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Falha no refino.';
    logger.error(`Refino job ${jobId} (feature #${number}, ${kind}) falhou: ${message}`);
    await updateRefineJob(tenantId, jobId, { status: 'error', error: message }).catch(() => {
      /* job pode ter expirado; nada a fazer */
    });
  } finally {
    // Métrica SpecWave/RefineDurationMs (alarme p90 na observabilidade).
    emitMetric('RefineDurationMs', Date.now() - startedAt, 'Milliseconds', { kind });
  }
}

// Leitura do job para o polling (respeitando o TTL). Escopo do tenant via PK.
export async function getRefineJobForTenant(tenantId: string, jobId: string) {
  return getRefineJob(tenantId, jobId);
}

// save: commita o conteúdo no arquivo (branch padrão) e devolve o WorkItemView
// recarregado — assim specMdx/planMdx atualizam na hora.
export async function saveArtifact(
  tenantId: string,
  id: string,
  number: number,
  kind: ArtifactKind,
  content: string,
): Promise<WorkItemView> {
  const config = await configForRepository(await getRepositoryOr404(tenantId, id));
  const path = await pathFor(config, number, kind);
  await putFileContent(config, path, content, `docs(${kind}): atualiza ${path} via UI`);
  return loadWorkItem(config, 'feature', number);
}
