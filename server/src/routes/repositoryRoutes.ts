// Rotas REST de repositórios (e dos work items escopados por repositório).

import { Router } from 'express';
import { getAllRepositories, getRepositoryEpics } from '../controllers/RepositoryController.ts';
import { getRepositoryWorkItem } from '../controllers/WorkItemController.ts';

export const repositoryRoutes = Router();

// GET /api/repositories → lista todos os repositórios conectados.
repositoryRoutes.get('/repositories', (req, res, next) => {
  getAllRepositories(req, res).catch(next);
});

// GET /api/repositories/:id/epics → épicos (issues [EPIC]) do repositório.
repositoryRoutes.get('/repositories/:id/epics', getRepositoryEpics);

// GET /api/repositories/:id/workitems/:level/:number → WorkItemView do repo.
repositoryRoutes.get('/repositories/:id/workitems/:level/:number', getRepositoryWorkItem);
