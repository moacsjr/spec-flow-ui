// Controllers da discussão integrada (canal Slack por Feature).

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';
import { listActiveDiscussions, openDiscussion } from '../services/discussionService.ts';

function handle(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// POST .../workitems/:level/:number/discussion { commentId } → { channelLink, created }
export async function postDiscussion(req: Request, res: Response, next: NextFunction): Promise<void> {
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
  const commentId = Number(((req.body ?? {}) as Record<string, unknown>).commentId);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    res.status(400).json({ error: 'commentId deve ser o id de um comentário publicado.' });
    return;
  }
  const tenant = tenantOf(req);
  try {
    res.json(await openDiscussion(tenant.tenantId, tenant.sub, id, n, commentId));
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../discussions → { discussions: [{ itemNumber, channelName, channelLink }] }
export async function getDiscussions(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  try {
    res.json({ discussions: await listActiveDiscussions(tenantOf(req).tenantId, id) });
  } catch (err) {
    handle(res, next, err);
  }
}
