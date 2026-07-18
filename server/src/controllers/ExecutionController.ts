// Controllers das telas de execução do TL (pontos, devolução, vereditos de QA
// e resumo de progresso por milestone).

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';
import {
  generateProgressSummary,
  qaApproveForRepository,
  qaReturnForRepository,
  qaReturnInfoForRepository,
  returnToReadyForRepository,
  setStoryPointsForRepository,
  setTaskStateForRepository,
  startWorkForRepository,
  uatApproveForRepository,
  uatReturnForRepository,
} from '../services/executionService.ts';

function paramsOr400(req: Request, res: Response): { repoId: string; n: number } | null {
  const { id, number } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return null;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return null;
  }
  return { repoId: id, n };
}

function handle(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// PATCH .../workitems/:level/:number/points — { points }
export async function patchWorkItemPoints(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const points = Number(((req.body ?? {}) as Record<string, unknown>).points);
  if (!Number.isFinite(points) || points <= 0) {
    res.status(400).json({ error: 'points deve ser um número > 0.' });
    return;
  }
  try {
    await setStoryPointsForRepository(tenantOf(req).tenantId, p.repoId, p.n, points);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/start — pull do dev (assignee + Development)
export async function postStartWork(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const tenant = tenantOf(req);
  try {
    res.json(await startWorkForRepository(tenant.tenantId, tenant.sub, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// PATCH .../workitems/:level/:number/state — { done } (Task checável)
export async function patchTaskState(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const done = ((req.body ?? {}) as Record<string, unknown>).done;
  if (typeof done !== 'boolean') {
    res.status(400).json({ error: 'done deve ser um booleano.' });
    return;
  }
  try {
    await setTaskStateForRepository(tenantOf(req).tenantId, p.repoId, p.n, done);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../workitems/:level/:number/qa-return-info → { reason, at } | null
export async function getQaReturnInfo(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await qaReturnInfoForRepository(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/return-to-ready
export async function postReturnToReady(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    await returnToReadyForRepository(tenantOf(req).tenantId, p.repoId, p.n);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/qa-approve → { movedTo }
export async function postQaApprove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await qaApproveForRepository(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/qa-return — { reason, createBug } → { bugNumber }
export async function postQaReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
    res.status(400).json({ error: 'Informe o motivo (mínimo 10 caracteres).' });
    return;
  }
  try {
    res.json(
      await qaReturnForRepository(
        tenantOf(req).tenantId,
        p.repoId,
        p.n,
        body.reason.trim(),
        body.createBug === true,
      ),
    );
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/uat-approve → { featureClosed, featureNumber, pendingCheck }
export async function postUatApprove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await uatApproveForRepository(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../workitems/:level/:number/uat-return — { reason, createBug } → { bugNumber }
export async function postUatReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
    res.status(400).json({ error: 'Informe o motivo (mínimo 10 caracteres).' });
    return;
  }
  try {
    res.json(
      await uatReturnForRepository(
        tenantOf(req).tenantId,
        p.repoId,
        p.n,
        body.reason.trim(),
        body.createBug === true,
      ),
    );
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../milestones/:milestoneNumber/progress-summary → { content }
export async function postProgressSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  const m = Number(req.params.milestoneNumber);
  if (!Number.isInteger(m) || m <= 0) {
    res.status(400).json({ error: `Milestone inválido: "${req.params.milestoneNumber}".` });
    return;
  }
  try {
    res.json({ content: await generateProgressSummary(tenantOf(req).tenantId, id, m) });
  } catch (err) {
    handle(res, next, err);
  }
}
