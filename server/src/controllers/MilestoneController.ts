// Controllers de milestones (RFC-003, Planning) — CRUD leve sobre o GitHub
// Milestones + atribuição de Story a milestone.

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';
import {
  createMilestoneForRepository,
  deleteMilestoneForRepository,
  listMilestonesForRepository,
  setStoryMilestoneForRepository,
  updateMilestoneForRepository,
} from '../services/milestoneService.ts';
import { generateReleaseNotes } from '../services/insightsService.ts';

function repoIdOr400(req: Request, res: Response): string | null {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return null;
  }
  return repoId;
}

function positiveIntOr400(res: Response, raw: string, label: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `${label} inválido: "${raw}".` });
    return null;
  }
  return n;
}

// Data-alvo: ISO ("2026-08-01" ou timestamp completo) ou null para limpar.
function parseDueOn(value: unknown, res: Response): string | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    res.status(400).json({ error: 'dueOn deve ser uma data ISO (ou null para limpar).' });
    return false;
  }
  // Milestones aceitam timestamp completo; data curta vira meia-noite UTC.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

// GET /api/repositories/:id/milestones
export async function getRepositoryMilestones(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;
  try {
    res.json(await listMilestonesForRepository(tenantOf(req).tenantId, repoId));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/milestones — { title, dueOn? }
export async function postRepositoryMilestone(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    res.status(400).json({ error: 'Informe o título do milestone.' });
    return;
  }
  const dueOn = parseDueOn(body.dueOn, res);
  if (dueOn === false) return;
  if ('description' in body && typeof body.description !== 'string') {
    res.status(400).json({ error: 'description deve ser texto.' });
    return;
  }

  try {
    const created = await createMilestoneForRepository(tenantOf(req).tenantId, repoId, {
      title: body.title.trim(),
      dueOn: dueOn ?? undefined,
      ...(typeof body.description === 'string' ? { description: body.description } : {}),
    });
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PATCH /api/repositories/:id/milestones/:milestoneNumber — { title?, dueOn?, state? }
export async function patchRepositoryMilestone(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;
  const milestoneNumber = positiveIntOr400(res, req.params.milestoneNumber, 'Milestone');
  if (milestoneNumber === null) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: {
    title?: string;
    dueOn?: string | null;
    state?: 'open' | 'closed';
    description?: string;
  } = {};
  if ('title' in body) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      res.status(400).json({ error: 'O título do milestone não pode ser vazio.' });
      return;
    }
    patch.title = body.title.trim();
  }
  if ('dueOn' in body) {
    const dueOn = parseDueOn(body.dueOn, res);
    if (dueOn === false) return;
    patch.dueOn = dueOn ?? null;
  }
  if ('state' in body) {
    if (body.state !== 'open' && body.state !== 'closed') {
      res.status(400).json({ error: 'state deve ser "open" ou "closed".' });
      return;
    }
    patch.state = body.state;
  }
  if ('description' in body) {
    if (typeof body.description !== 'string') {
      res.status(400).json({ error: 'description deve ser texto.' });
      return;
    }
    patch.description = body.description;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nada para atualizar: informe title, dueOn, state e/ou description.' });
    return;
  }

  try {
    await updateMilestoneForRepository(tenantOf(req).tenantId, repoId, milestoneNumber, patch);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// DELETE /api/repositories/:id/milestones/:milestoneNumber
export async function deleteRepositoryMilestone(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;
  const milestoneNumber = positiveIntOr400(res, req.params.milestoneNumber, 'Milestone');
  if (milestoneNumber === null) return;

  try {
    await deleteMilestoneForRepository(tenantOf(req).tenantId, repoId, milestoneNumber);
    res.status(204).end();
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// POST /api/repositories/:id/milestones/:milestoneNumber/release-notes → { content }
// Aciona a LLM para gerar Release Notes a partir das Stories do milestone.
export async function postMilestoneReleaseNotes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;
  const milestoneNumber = positiveIntOr400(res, req.params.milestoneNumber, 'Milestone');
  if (milestoneNumber === null) return;

  try {
    const content = await generateReleaseNotes(tenantOf(req).tenantId, repoId, milestoneNumber);
    res.json({ content });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PUT /api/repositories/:id/workitems/story/:number/milestone — { milestoneNumber: number|null }
export async function putStoryMilestone(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = repoIdOr400(req, res);
  if (!repoId) return;
  const storyNumber = positiveIntOr400(res, req.params.number, 'Número da story');
  if (storyNumber === null) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!('milestoneNumber' in body)) {
    res.status(400).json({ error: 'Informe milestoneNumber (número do milestone ou null).' });
    return;
  }
  let milestoneNumber: number | null = null;
  if (body.milestoneNumber !== null) {
    const n = Number(body.milestoneNumber);
    if (!Number.isInteger(n) || n <= 0) {
      res.status(400).json({ error: `milestoneNumber inválido: "${String(body.milestoneNumber)}".` });
      return;
    }
    milestoneNumber = n;
  }

  try {
    await setStoryMilestoneForRepository(
      tenantOf(req).tenantId,
      repoId,
      storyNumber,
      milestoneNumber,
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
