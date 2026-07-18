// Controllers da tela Specification do PM (versões do spec.md, triagem de
// comentários de revisão e aprovação/retorno).

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';
import type { SpecTriageState } from '../db/dynamo.ts';
import {
  approveSpec,
  getSpecBlob,
  getSpecMeta,
  getSpecStatus,
  listReviewComments,
  replyToReviewComment,
  returnSpecToPrioritization,
  setReviewCommentTriage,
} from '../services/specReviewService.ts';

const TRIAGE_STATES: SpecTriageState[] = ['pending', 'accepted', 'dismissed', 'applied'];

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

// GET .../feature/:number/spec/meta → { path, content, sha, versions }
export async function getFeatureSpecMeta(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await getSpecMeta(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/spec/blob/:sha → { content }
export async function getFeatureSpecBlob(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const sha = req.params.sha;
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
    res.status(400).json({ error: `Revisão inválida: "${sha}".` });
    return;
  }
  try {
    res.json({ content: await getSpecBlob(tenantOf(req).tenantId, p.repoId, p.n, sha) });
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/spec/status → { hasSpec, latestRun }
export async function getFeatureSpecStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await getSpecStatus(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/review-comments → { comments }
export async function getFeatureReviewComments(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json({ comments: await listReviewComments(tenantOf(req).tenantId, p.repoId, p.n) });
  } catch (err) {
    handle(res, next, err);
  }
}

// PATCH .../feature/:number/review-comments/:commentId → { state, instruction? }
export async function patchReviewCommentTriage(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    res.status(400).json({ error: `commentId inválido: "${req.params.commentId}".` });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!TRIAGE_STATES.includes(body.state as SpecTriageState)) {
    res.status(400).json({ error: `state deve ser um de: ${TRIAGE_STATES.join(', ')}.` });
    return;
  }
  if (body.instruction !== undefined && typeof body.instruction !== 'string') {
    res.status(400).json({ error: 'instruction deve ser texto.' });
    return;
  }
  try {
    await setReviewCommentTriage(
      tenantOf(req).tenantId,
      p.repoId,
      p.n,
      commentId,
      body.state as SpecTriageState,
      body.instruction as string | undefined,
    );
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/review-comments/reply → { body } (réplica na issue)
export async function postReviewCommentReply(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    res.status(400).json({ error: 'Informe o corpo da réplica.' });
    return;
  }
  try {
    await replyToReviewComment(tenantOf(req).tenantId, p.repoId, p.n, body.body.trim());
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/spec/approve → { milestoneNumber: number | null }
export async function postSpecApprove(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!('milestoneNumber' in body)) {
    res.status(400).json({ error: 'Informe milestoneNumber (número ou null).' });
    return;
  }
  let milestoneNumber: number | null = null;
  if (body.milestoneNumber !== null) {
    const m = Number(body.milestoneNumber);
    if (!Number.isInteger(m) || m <= 0) {
      res.status(400).json({ error: `milestoneNumber inválido: "${String(body.milestoneNumber)}".` });
      return;
    }
    milestoneNumber = m;
  }
  try {
    await approveSpec(tenantOf(req).tenantId, p.repoId, p.n, milestoneNumber);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/return-to-prioritization
export async function postReturnToPrioritization(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    await returnSpecToPrioritization(tenantOf(req).tenantId, p.repoId, p.n);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}
