// Controllers de repositórios:
//   - getAllRepositories  → lista do SQLite (Dashboard)
//   - getRepositoryEpics  → épicos do repo no GitHub (issues [EPIC])

import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { config } from '../config.ts';
import { logger } from '../lib/logger.ts';
import { isValidHttpUrl } from '../lib/validation.ts';
import { HttpError } from '../lib/errors.ts';
import { loadEpicSummaries } from '../services/workItemService.ts';
import { toRepositoryDTO, type RepositoryRow } from '../services/repositoryService.ts';

export async function getAllRepositories(_req: Request, res: Response): Promise<void> {
  const rows = await db<RepositoryRow>('repositories')
    .select('id', 'name', 'url', 'created_at')
    .orderBy('created_at', 'desc') // mais recentes primeiro
    .limit(config.pageLimit); // até 50 (paginação futura)

  for (const row of rows) {
    // URL inválida (dados corrompidos): loga mas não bloqueia a listagem.
    if (!isValidHttpUrl(row.url)) logger.warn(`Repositório #${row.id} com URL inválida: ${row.url}`);
  }

  res.json(rows.map(toRepositoryDTO));
}

export async function getRepositoryEpics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const repoId = Number(req.params.id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    res.status(400).json({ error: `Repositório inválido: "${req.params.id}".` });
    return;
  }

  try {
    res.json(await loadEpicSummaries(repoId));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
}
