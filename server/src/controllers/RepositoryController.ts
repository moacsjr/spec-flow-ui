// Controllers de repositórios:
//   - getAllRepositories  → lista do SQLite (Dashboard)
//   - getRepositoryEpics  → épicos do repo no GitHub (issues [EPIC])

import type { NextFunction, Request, Response } from 'express';
import { isValidRepoId } from '../lib/validation.ts';
import { HttpError } from '../lib/errors.ts';
import { tenantOf } from '../middleware/auth.ts';
import { visibleRepoIds } from '../middleware/authorize.ts';
import { putAuditLog } from '../db/dynamo.ts';
import { loadEpicSummaries } from '../services/workItemService.ts';
import {
  createRepository,
  getRepository,
  listRepositories,
  updateRepository,
} from '../services/repositoryService.ts';

export async function getAllRepositories(req: Request, res: Response): Promise<void> {
  const tenant = tenantOf(req);
  const repos = await listRepositories(tenant.tenantId);
  // Papéis por repositório (spec Gestão de usuários §4.1): membro sem papel não
  // vê o repositório no seletor; owner (root) vê todos.
  const visible = await visibleRepoIds(tenant.tenantId, tenant.sub, tenant.role);
  res.json(visible === null ? repos : repos.filter((r) => visible.has(r.id)));
}

// POST /api/repositories — cadastra um repositório (e, opcionalmente, introspecta
// o Projects v2 informado para habilitar a movimentação de etapa pela UI).
export async function postRepository(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.url !== 'string' || body.url.trim().length === 0) {
    res.status(400).json({ error: 'Informe a URL do repositório.' });
    return;
  }
  if (body.projectUrl !== undefined && typeof body.projectUrl !== 'string') {
    res.status(400).json({ error: 'projectUrl deve ser um texto.' });
    return;
  }

  try {
    const tenant = tenantOf(req);
    const repo = await createRepository(tenant.tenantId, {
      url: body.url,
      projectUrl: typeof body.projectUrl === 'string' ? body.projectUrl : undefined,
    });
    putAuditLog({
      tenantId: tenant.tenantId,
      at: new Date().toISOString(),
      sub: tenant.sub,
      action: 'repository.create',
      target: repo.id,
      detail: repo.name,
    }).catch(() => undefined);
    res.status(201).json(repo);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// GET /api/repositories/:id — um repositório (para pré-preencher a edição).
export async function getRepositoryById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }
  try {
    res.json(await getRepository(tenantOf(req).tenantId, repoId));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// PATCH /api/repositories/:id — edita url e/ou vínculo com o Projects v2.
export async function patchRepository(
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
  const input: {
    url?: string;
    projectUrl?: string;
    wipThreshold?: number | null;
    slackBotToken?: string;
  } = {};
  if ('url' in body) {
    if (typeof body.url !== 'string' || body.url.trim().length === 0) {
      res.status(400).json({ error: 'A URL do repositório não pode ser vazia.' });
      return;
    }
    input.url = body.url;
  }
  if ('projectUrl' in body) {
    if (typeof body.projectUrl !== 'string') {
      res.status(400).json({ error: 'projectUrl deve ser um texto (vazio para desvincular).' });
      return;
    }
    input.projectUrl = body.projectUrl;
  }
  if ('wipThreshold' in body) {
    if (body.wipThreshold !== null && typeof body.wipThreshold !== 'number') {
      res.status(400).json({ error: 'wipThreshold deve ser um número (ou null para o default).' });
      return;
    }
    input.wipThreshold = body.wipThreshold as number | null;
  }
  if ('slackBotToken' in body) {
    if (typeof body.slackBotToken !== 'string') {
      res.status(400).json({ error: 'slackBotToken deve ser um texto (vazio para remover).' });
      return;
    }
    input.slackBotToken = body.slackBotToken;
  }
  if (
    input.url === undefined &&
    input.projectUrl === undefined &&
    input.wipThreshold === undefined &&
    input.slackBotToken === undefined
  ) {
    res.status(400).json({ error: 'Nada para atualizar: informe url, projectUrl, wipThreshold e/ou slackBotToken.' });
    return;
  }

  try {
    const tenant = tenantOf(req);
    const updated = await updateRepository(tenant.tenantId, repoId, input);
    putAuditLog({
      tenantId: tenant.tenantId,
      at: new Date().toISOString(),
      sub: tenant.sub,
      action: 'repository.update',
      target: repoId,
      detail: Object.keys(input).join(','),
    }).catch(() => undefined);
    res.json(updated);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}

export async function getRepositoryEpics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = req.params.id;
  if (!isValidRepoId(repoId)) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }

  try {
    res.json(await loadEpicSummaries(tenantOf(req).tenantId, repoId));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}
