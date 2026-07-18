// Controller de work item — valida a rota (repo + nível + número), chama o
// serviço e devolve o WorkItemView pronto para exibição. Mapeia erros de domínio
// para HTTP: 400 (entrada inválida), 404 (não encontrado), 502 (GitHub),
// 503 (não configurado).

import type { NextFunction, Request, Response } from 'express';
import type {
  CreateFeatureRequest,
  CreateWorkItemRequest,
  Level,
  Priority,
  StageName,
  WorkItemPatch,
  WorkItemType,
} from '@spec-flow/shared';
import { STAGE_NAMES, WORK_ITEM_TYPES } from '@spec-flow/shared';
import {
  archiveWorkItemSubtreeForRepository,
  bulkArchiveForRepository,
  bulkPrioritizeForRepository,
  bulkReparentForRepository,
  createFeatureForRepository,
  createWorkItemForRepository,
  deleteWorkItemForRepository,
  loadWorkItemForRepository,
  prioritizeWorkItemForRepository,
  setPriorityForRepository,
  setRankForRepository,
  setStageForRepository,
  setWorkItemParentForRepository,
  stageAgesForRepository,
  startDevelopmentForRepository,
  updateWorkItemForRepository,
} from '../services/workItemService.ts';
import { setDisplayOrderForRepository } from '../services/snapshotService.ts';
import { listEstimateMeta, setManualEstimate } from '../services/estimateService.ts';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';

const LEVELS: Level[] = ['epic', 'feature', 'story'];

// Valores aceitos para os campos opcionais da Feature (espelham o RFC-001 e o
// adapter, que lê Prioridade/Área dos labels da issue).
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const AREAS = ['Frontend', 'Backend', 'Mobile', 'Infra', 'DevOps', 'Data'];

export async function getRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id, level, number } = req.params;

  const repoId = id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  if (!LEVELS.includes(level as Level)) {
    res.status(400).json({ error: `Nível inválido: "${level}". Use epic, feature ou story.` });
    return;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return;
  }

  try {
    res.json(await loadWorkItemForRepository(tenantOf(req).tenantId, repoId, level as Level, n));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// PATCH /api/repositories/:id/workitems/:level/:number — edita título/corpo da
// issue. Aceita { title?, descriptionMdx? } (ao menos um). Devolve o WorkItemView
// atualizado. Requer GITHUB_TOKEN com escopo de escrita em issues.
export async function updateRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id, level, number } = req.params;

  const repoId = id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  if (!LEVELS.includes(level as Level)) {
    res.status(400).json({ error: `Nível inválido: "${level}". Use epic, feature ou story.` });
    return;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return;
  }

  // Validação do corpo (já parseado por express.json()).
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: WorkItemPatch = {};
  if ('title' in body) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      res.status(400).json({ error: 'O título não pode ser vazio.' });
      return;
    }
    patch.title = body.title.trim();
  }
  if ('descriptionMdx' in body) {
    if (typeof body.descriptionMdx !== 'string') {
      res.status(400).json({ error: 'A descrição deve ser um texto.' });
      return;
    }
    patch.descriptionMdx = body.descriptionMdx;
  }
  if (patch.title === undefined && patch.descriptionMdx === undefined) {
    res.status(400).json({ error: 'Nada para atualizar: informe title e/ou descriptionMdx.' });
    return;
  }

  try {
    res.json(await updateWorkItemForRepository(tenantOf(req).tenantId, repoId, level as Level, n, patch));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// Valida os params comuns (:id, :level, :number) das rotas de workspace.
// Devolve null (resposta 400 já enviada) quando algo é inválido.
function workItemParamsOr400(
  req: Request,
  res: Response,
): { repoId: string; level: Level; n: number } | null {
  const { id, level, number } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return null;
  }
  if (!LEVELS.includes(level as Level)) {
    res.status(400).json({ error: `Nível inválido: "${level}". Use epic, feature ou story.` });
    return null;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return null;
  }
  return { repoId: id, level: level as Level, n };
}

// PATCH /api/repositories/:id/workitems/:level/:number/priority — troca os
// labels P0–P3 da issue. Corpo: { priority: 'P0'…'P3' | null } (null remove).
export async function setWorkItemPriority(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = workItemParamsOr400(req, res);
  if (!params) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!('priority' in body)) {
    res.status(400).json({ error: 'Informe priority (P0–P3 ou null para remover).' });
    return;
  }
  if (body.priority !== null && !PRIORITIES.includes(body.priority as string)) {
    res.status(400).json({ error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')} ou null.` });
    return;
  }

  try {
    await setPriorityForRepository(
      tenantOf(req).tenantId,
      params.repoId,
      params.n,
      (body.priority as Priority | null) ?? null,
    );
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// DELETE /api/repositories/:id/workitems/:level/:number — "Delete" do Backlog:
// fecha a issue no GitHub (issues não são deletáveis pela API).
export async function deleteRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = workItemParamsOr400(req, res);
  if (!params) return;

  try {
    await deleteWorkItemForRepository(tenantOf(req).tenantId, params.repoId, params.n);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/workitems/:level/:number/archive → arquiva (fecha)
// o item e todos os descendentes. O `:level` é só decorativo (Initiative não é
// um Level válido), então validamos apenas repo + número.
export async function archiveRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id, number } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return;
  }

  try {
    const result = await archiveWorkItemSubtreeForRepository(tenantOf(req).tenantId, id, n);
    res.json(result);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ---- Backlog do PM: priorização + operações em lote ----

function repoIdParamOr400(req: Request, res: Response): string | null {
  const { id } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return null;
  }
  return id;
}

function priorityOr400(res: Response, value: unknown): Priority | null {
  if (!PRIORITIES.includes(value as Priority)) {
    res.status(400).json({ error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')}.` });
    return null;
  }
  return value as Priority;
}

function numbersOr400(res: Response, value: unknown): number[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((n) => Number.isInteger(n) && n > 0)
  ) {
    res.status(400).json({ error: 'numbers deve ser uma lista de números de issue (> 0).' });
    return null;
  }
  return value as number[];
}

// POST /api/repositories/:id/workitems/:level/:number/prioritize — { priority }.
// Grava prioridade + move a Etapa (Feature → Priorizado; Spike → Ready) + Rank.
// O `:level` é decorativo (Spike não é um Level); valida repo + número.
export async function prioritizeRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${req.params.number}".` });
    return;
  }
  const priority = priorityOr400(res, ((req.body ?? {}) as Record<string, unknown>).priority);
  if (!priority) return;

  try {
    await prioritizeWorkItemForRepository(tenantOf(req).tenantId, id, n, priority);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/workitems/bulk/prioritize — { numbers, priority }.
export async function bulkPrioritizeWorkItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const numbers = numbersOr400(res, body.numbers);
  if (!numbers) return;
  const priority = priorityOr400(res, body.priority);
  if (!priority) return;

  try {
    res.json({ results: await bulkPrioritizeForRepository(tenantOf(req).tenantId, id, numbers, priority) });
  } catch (err) {
    next(err);
  }
}

// POST /api/repositories/:id/workitems/bulk/reparent — { numbers, parentNumber }.
export async function bulkReparentWorkItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const numbers = numbersOr400(res, body.numbers);
  if (!numbers) return;
  const parentNumber = Number(body.parentNumber);
  if (!Number.isInteger(parentNumber) || parentNumber <= 0) {
    res.status(400).json({ error: `parentNumber inválido: "${String(body.parentNumber)}".` });
    return;
  }

  try {
    res.json({
      results: await bulkReparentForRepository(tenantOf(req).tenantId, id, numbers, parentNumber),
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/repositories/:id/workitems/:level/:number/rank — { rank: number }.
// Persistência do drag de reordenação da Prioritization.
export async function patchWorkItemRank(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${req.params.number}".` });
    return;
  }
  const rank = Number(((req.body ?? {}) as Record<string, unknown>).rank);
  if (!Number.isFinite(rank)) {
    res.status(400).json({ error: 'rank deve ser um número.' });
    return;
  }

  try {
    await setRankForRepository(tenantOf(req).tenantId, id, n, rank);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PATCH /api/repositories/:id/workitems/feature/:number/estimate — { points }.
// Override manual da estimativa (origem manual; não é sobrescrita pela IA).
export async function patchFeatureEstimate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${req.params.number}".` });
    return;
  }
  const points = Number(((req.body ?? {}) as Record<string, unknown>).points);
  if (!Number.isFinite(points) || points < 0) {
    res.status(400).json({ error: 'points deve ser um número ≥ 0.' });
    return;
  }

  try {
    await setManualEstimate(tenantOf(req).tenantId, id, n, points);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// GET /api/repositories/:id/estimates-meta → { estimates: [{issueNumber, origin, stale}] }
export async function getEstimatesMeta(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  try {
    res.json({ estimates: await listEstimateMeta(tenantOf(req).tenantId, id) });
  } catch (err) {
    next(err);
  }
}

// GET /api/repositories/:id/stage-ages?stage=Priorizado → { ages: [{number, at, approximate}] }
export async function getStageAges(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const stage = req.query.stage;
  if (typeof stage !== 'string' || !STAGE_NAMES.includes(stage as StageName)) {
    res.status(400).json({ error: `stage inválida. Use uma de: ${STAGE_NAMES.join(', ')}.` });
    return;
  }

  try {
    res.json({ ages: await stageAgesForRepository(tenantOf(req).tenantId, id, stage as StageName) });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/workitems/bulk/archive — { numbers } (individual, sem cascata).
export async function bulkArchiveWorkItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const id = repoIdParamOr400(req, res);
  if (!id) return;
  const numbers = numbersOr400(res, ((req.body ?? {}) as Record<string, unknown>).numbers);
  if (!numbers) return;

  try {
    res.json({ results: await bulkArchiveForRepository(tenantOf(req).tenantId, id, numbers) });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/repositories/:id/workitems/:level/:number/stage — move a etapa
// canônica do item no board. Corpo: { stage: StageName }.
export async function setWorkItemStage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const params = workItemParamsOr400(req, res);
  if (!params) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!STAGE_NAMES.includes(body.stage as StageName)) {
    res.status(400).json({ error: `Etapa inválida. Use uma de: ${STAGE_NAMES.join(', ')}.` });
    return;
  }

  try {
    await setStageForRepository(
      tenantOf(req).tenantId,
      params.repoId,
      params.n,
      body.stage as StageName,
    );
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/workitems/story/:number/start-development — aplica
// o label spec-wave:dev-agent na Story (CTA "Iniciar Desenvolvimento" da Story
// View). Devolve o WorkItemView recarregado (devAgentRequested=true).
export async function startStoryDevelopment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }
  const n = Number(req.params.number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${req.params.number}".` });
    return;
  }

  try {
    res.json(await startDevelopmentForRepository(tenantOf(req).tenantId, repoId, n));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// POST /api/repositories/:id/workitems/epic/:number/features — cria uma Feature
// sob o épico :number. Corpo: { title (obrigatório), descriptionMdx?, priority?,
// area? }. Devolve 201 + o WorkItemView do épico recarregado (com a nova feature).
export async function createRepositoryFeature(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id, number } = req.params;

  const repoId = id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  const epicNumber = Number(number);
  if (!Number.isInteger(epicNumber) || epicNumber <= 0) {
    res.status(400).json({ error: `Número do épico inválido: "${number}".` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    res.status(400).json({ error: 'Informe o título da feature.' });
    return;
  }
  if (body.descriptionMdx !== undefined && typeof body.descriptionMdx !== 'string') {
    res.status(400).json({ error: 'A descrição deve ser um texto.' });
    return;
  }
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority as string)) {
    res.status(400).json({ error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')}.` });
    return;
  }
  if (body.area !== undefined && !AREAS.includes(body.area as string)) {
    res.status(400).json({ error: `Área inválida. Use uma de: ${AREAS.join(', ')}.` });
    return;
  }

  const input: CreateFeatureRequest = { title: body.title.trim() };
  if (typeof body.descriptionMdx === 'string') input.descriptionMdx = body.descriptionMdx;
  if (typeof body.priority === 'string') input.priority = body.priority;
  if (typeof body.area === 'string') input.area = body.area;

  try {
    res.status(201).json(await createFeatureForRepository(tenantOf(req).tenantId, repoId, epicNumber, input));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// POST /api/repositories/:id/workitems → cria um work item de qualquer tipo
// (Initiative/Epic/Feature/Story/Task/Bug/Spike), opcionalmente como sub-issue
// de `parentNumber`, e o adiciona ao board. Usado pela tela Project do PM.
export async function createRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.type !== 'string' || !WORK_ITEM_TYPES.includes(body.type as WorkItemType)) {
    res.status(400).json({ error: `Tipo inválido. Use um de: ${WORK_ITEM_TYPES.join(', ')}.` });
    return;
  }
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    res.status(400).json({ error: 'Informe o título do item.' });
    return;
  }
  if (body.descriptionMdx !== undefined && typeof body.descriptionMdx !== 'string') {
    res.status(400).json({ error: 'A descrição deve ser um texto.' });
    return;
  }
  if (body.priority !== undefined && !PRIORITIES.includes(body.priority as string)) {
    res.status(400).json({ error: `Prioridade inválida. Use uma de: ${PRIORITIES.join(', ')}.` });
    return;
  }
  if (body.area !== undefined && !AREAS.includes(body.area as string)) {
    res.status(400).json({ error: `Área inválida. Use uma de: ${AREAS.join(', ')}.` });
    return;
  }
  let parentNumber: number | undefined;
  if (body.parentNumber !== undefined && body.parentNumber !== null) {
    parentNumber = Number(body.parentNumber);
    if (!Number.isInteger(parentNumber) || parentNumber <= 0) {
      res.status(400).json({ error: `Número do pai inválido: "${String(body.parentNumber)}".` });
      return;
    }
  }

  const input: CreateWorkItemRequest = {
    type: body.type as WorkItemType,
    title: body.title.trim(),
  };
  if (typeof body.descriptionMdx === 'string') input.descriptionMdx = body.descriptionMdx;
  if (typeof body.priority === 'string') input.priority = body.priority;
  if (typeof body.area === 'string') input.area = body.area;
  if (parentNumber !== undefined) input.parentNumber = parentNumber;

  try {
    res.status(201).json(await createWorkItemForRepository(tenantOf(req).tenantId, repoId, input));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// POST /api/repositories/:id/reparent → define o pai (sub-issue nativa) de um
// item, validando a hierarquia permitida. Usado no drag-and-drop da tela Project.
export async function reparentWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const childNumber = Number(body.childNumber);
  const parentNumber = Number(body.parentNumber);
  if (!Number.isInteger(childNumber) || childNumber <= 0) {
    res.status(400).json({ error: 'childNumber inválido.' });
    return;
  }
  if (!Number.isInteger(parentNumber) || parentNumber <= 0) {
    res.status(400).json({ error: 'parentNumber inválido.' });
    return;
  }

  try {
    await setWorkItemParentForRepository(tenantOf(req).tenantId, repoId, childNumber, parentNumber);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}

// POST /api/repositories/:id/reorder → grava a ordem de exibição custom (lista
// global de números de issue). Usado no reorder por Shift-drag da tela Project.
export async function reorderWorkItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.order) || !body.order.every((n) => typeof n === 'number')) {
    res.status(400).json({ error: 'order inválido: esperado um array de números.' });
    return;
  }

  try {
    await setDisplayOrderForRepository(tenantOf(req).tenantId, repoId, body.order as number[]);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}
