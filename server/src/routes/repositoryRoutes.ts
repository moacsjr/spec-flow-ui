// Rotas REST de repositórios (e dos work items escopados por repositório).

import { Router } from 'express';
import { requireOwner } from '../middleware/auth.ts';
import {
  getAllRepositories,
  getRepositoryById,
  getRepositoryEpics,
  patchRepository,
  postRepository,
} from '../controllers/RepositoryController.ts';
import {
  createRepositoryFeature,
  createRepositoryWorkItem,
  deleteRepositoryWorkItem,
  getRepositoryWorkItem,
  reorderWorkItems,
  reparentWorkItem,
  setWorkItemPriority,
  setWorkItemStage,
  startStoryDevelopment,
  updateRepositoryWorkItem,
} from '../controllers/WorkItemController.ts';
import {
  deleteRepositoryMilestone,
  getRepositoryMilestones,
  patchRepositoryMilestone,
  postMilestoneReleaseNotes,
  postRepositoryMilestone,
  putStoryMilestone,
} from '../controllers/MilestoneController.ts';
import {
  approveFeaturePlan,
  createFeatureArtifact,
  decomposeFeatureHandler,
  getRefineJobStatus,
  refineFeatureArtifact,
  saveFeatureArtifact,
} from '../controllers/ArtifactController.ts';
import { getRepositorySnapshot } from '../controllers/SnapshotController.ts';
import { postRepositoryInsight } from '../controllers/InsightsController.ts';

export const repositoryRoutes = Router();

// GET /api/repositories → lista todos os repositórios conectados.
repositoryRoutes.get('/repositories', (req, res, next) => {
  getAllRepositories(req, res).catch(next);
});

// POST /api/repositories → cadastra um repositório (e Projects v2 opcional).
// Gestão de repositórios é restrita ao owner (membros só usam).
repositoryRoutes.post('/repositories', requireOwner, postRepository);

// GET /api/repositories/:id → um repositório (pré-preenche a edição).
repositoryRoutes.get('/repositories/:id', getRepositoryById);

// PATCH /api/repositories/:id → edita url e/ou vínculo com o Projects v2.
repositoryRoutes.patch('/repositories/:id', requireOwner, patchRepository);

// GET /api/repositories/:id/epics → épicos (issues [EPIC]) do repositório.
repositoryRoutes.get('/repositories/:id/epics', getRepositoryEpics);

// GET /api/repositories/:id/snapshot → snapshot agregado do repo (RFC-003):
// todas as issues (flat) + milestones, com etapa/prioridade/PRs. Cache 60s;
// `?fresh=1` força releitura.
repositoryRoutes.get('/repositories/:id/snapshot', (req, res, next) => {
  getRepositorySnapshot(req, res, next).catch(next);
});

// Milestones (RFC-003, Planning): GitHub Milestones é a fonte de verdade.
repositoryRoutes.get('/repositories/:id/milestones', getRepositoryMilestones);
repositoryRoutes.post('/repositories/:id/milestones', postRepositoryMilestone);
repositoryRoutes.patch('/repositories/:id/milestones/:milestoneNumber', patchRepositoryMilestone);
repositoryRoutes.delete('/repositories/:id/milestones/:milestoneNumber', deleteRepositoryMilestone);
repositoryRoutes.post(
  '/repositories/:id/milestones/:milestoneNumber/release-notes',
  (req, res, next) => {
    postMilestoneReleaseNotes(req, res, next).catch(next);
  },
);

// PUT /api/repositories/:id/workitems/story/:number/milestone → atribui/remove
// o milestone de uma Story (só Stories entram em milestones — RFC-003).
repositoryRoutes.put('/repositories/:id/workitems/story/:number/milestone', putStoryMilestone);

// POST /api/repositories/:id/workitems/story/:number/start-development → aplica
// o label spec-wave:dev-agent na Story (CTA "Iniciar Desenvolvimento").
repositoryRoutes.post(
  '/repositories/:id/workitems/story/:number/start-development',
  startStoryDevelopment,
);

// GET /api/repositories/:id/workitems/:level/:number → WorkItemView do repo.
repositoryRoutes.get('/repositories/:id/workitems/:level/:number', getRepositoryWorkItem);

// PATCH /api/repositories/:id/workitems/:level/:number/priority → swap dos
// labels P0–P3 (workspace PM: Set Priority / Prioritization).
repositoryRoutes.patch('/repositories/:id/workitems/:level/:number/priority', setWorkItemPriority);

// PATCH /api/repositories/:id/workitems/:level/:number/stage → move a etapa
// canônica no board (Start Story, aprovar/devolver UAT, Technical Backlog).
repositoryRoutes.patch('/repositories/:id/workitems/:level/:number/stage', setWorkItemStage);

// DELETE /api/repositories/:id/workitems/:level/:number → fecha a issue
// ("Delete" do Backlog do PM).
repositoryRoutes.delete('/repositories/:id/workitems/:level/:number', deleteRepositoryWorkItem);

// PATCH /api/repositories/:id/workitems/:level/:number → edita título/corpo da issue.
repositoryRoutes.patch('/repositories/:id/workitems/:level/:number', updateRepositoryWorkItem);

// POST /api/repositories/:id/workitems → cria um work item de qualquer tipo
// (opcionalmente sub-issue de parentNumber) e o adiciona ao board — tela Project.
repositoryRoutes.post('/repositories/:id/workitems', createRepositoryWorkItem);

// POST /api/repositories/:id/reparent → define o pai de um item (drag-and-drop
// da árvore), validando a hierarquia permitida.
repositoryRoutes.post('/repositories/:id/reparent', reparentWorkItem);

// POST /api/repositories/:id/reorder → grava a ordem de exibição custom
// (reorder por Shift-drag da árvore).
repositoryRoutes.post('/repositories/:id/reorder', reorderWorkItems);

// POST /api/repositories/:id/workitems/epic/:number/features → cria uma Feature
// sob o épico (issue [FEATURE] + vínculo de sub-issue + entrada no Projects v2).
repositoryRoutes.post('/repositories/:id/workitems/epic/:number/features', createRepositoryFeature);

// Ciclo de spec.md / plan.md de uma Feature (:artifact ∈ {spec, plan}):
//   create → label do spec-wave + move etapa (a Action gera o arquivo)
//   refine → registra prompt como comentário + gera texto via LLM (sem salvar)
//   save   → commita o conteúdo no arquivo (branch padrão)
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/:artifact/create',
  createFeatureArtifact,
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/:artifact/refine',
  refineFeatureArtifact,
);
// Polling do refino assíncrono (202 + job): status do job de refino.
repositoryRoutes.get(
  '/repositories/:id/workitems/feature/:number/:artifact/refine/:jobId',
  getRefineJobStatus,
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/:artifact/save',
  saveFeatureArtifact,
);

// Aprovação do plan.md: aplica o label spec-wave:ready na Feature.
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/plan/approve',
  approveFeaturePlan,
);

// Decomposição: aplica spec-wave:decompose para disparar a Action.
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/decompose',
  decomposeFeatureHandler,
);

// POST /api/repositories/:id/ai/summary → AI insight/summary de um escopo
// (pm-progress | tech-insights | dev-daily | brainstorm). Consome cota de
// refine, salvo tenant com chave OpenRouter própria.
repositoryRoutes.post('/repositories/:id/ai/summary', postRepositoryInsight);
