// Controller de work item — valida a rota (repo + nível + número), chama o
// serviço e devolve o WorkItemView pronto para exibição. Mapeia erros de domínio
// para HTTP: 400 (entrada inválida), 404 (não encontrado), 502 (GitHub),
// 503 (não configurado).

import type { NextFunction, Request, Response } from 'express';
import type { Level } from '@spec-flow/shared';
import { loadWorkItemForRepository } from '../services/workItemService.ts';
import { HttpError } from '../lib/errors.ts';

const LEVELS: Level[] = ['epic', 'feature', 'story'];

export async function getRepositoryWorkItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id, level, number } = req.params;

  const repoId = Number(id);
  if (!Number.isInteger(repoId) || repoId <= 0) {
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
    res.json(await loadWorkItemForRepository(repoId, level as Level, n));
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err); // erro inesperado → handler central (500)
  }
}
