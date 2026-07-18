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
  archiveRepositoryWorkItem,
  bulkArchiveWorkItems,
  bulkPrioritizeWorkItems,
  bulkReparentWorkItems,
  createRepositoryFeature,
  createRepositoryWorkItem,
  deleteRepositoryWorkItem,
  getEstimatesMeta,
  getStageAges,
  patchFeatureEstimate,
  patchWorkItemRank,
  prioritizeRepositoryWorkItem,
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
  patchFeatureMilestone,
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
import {
  deleteReviewDraftHandler,
  getDecomposition,
  getFeaturePlanStatus,
  getPlanValidationHandler,
  patchDecomposition,
  postDecompositionGenerate,
  postDecompositionMaterialize,
  getPreReviewHandler,
  getReviewCycleHandler,
  getReviewDrafts,
  patchReviewDraft,
  postPreReviewRun,
  postReturnToPm,
  postReviewDraft,
} from '../controllers/TechReviewController.ts';
import { getRepositorySnapshot } from '../controllers/SnapshotController.ts';
import { postRepositoryInsight } from '../controllers/InsightsController.ts';
import {
  getFeaturePlanBlob,
  getFeaturePlanMeta,
  getFeatureReviewComments,
  getFeatureSpecBlob,
  getFeatureSpecMeta,
  getFeatureSpecStatus,
  patchReviewCommentTriage,
  postReturnToPrioritization,
  postReviewCommentReply,
  postSpecApprove,
} from '../controllers/SpecReviewController.ts';

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

// POST /api/repositories/:id/workitems/:level/:number/archive → arquiva (fecha)
// o item + todos os descendentes (Backlog do PM).
repositoryRoutes.post('/repositories/:id/workitems/:level/:number/archive', (req, res, next) => {
  archiveRepositoryWorkItem(req, res, next).catch(next);
});

// Backlog do PM — priorização (prioridade + etapa + rank) e operações em lote.
// Os bulk vêm ANTES das rotas parametrizadas por clareza (shapes não colidem).
repositoryRoutes.post('/repositories/:id/workitems/bulk/prioritize', (req, res, next) => {
  bulkPrioritizeWorkItems(req, res, next).catch(next);
});
repositoryRoutes.post('/repositories/:id/workitems/bulk/reparent', (req, res, next) => {
  bulkReparentWorkItems(req, res, next).catch(next);
});
repositoryRoutes.post('/repositories/:id/workitems/bulk/archive', (req, res, next) => {
  bulkArchiveWorkItems(req, res, next).catch(next);
});
repositoryRoutes.post('/repositories/:id/workitems/:level/:number/prioritize', (req, res, next) => {
  prioritizeRepositoryWorkItem(req, res, next).catch(next);
});

// Rank (drag da Prioritization) e idades por etapa (tempo-na-etapa).
repositoryRoutes.patch('/repositories/:id/workitems/:level/:number/rank', (req, res, next) => {
  patchWorkItemRank(req, res, next).catch(next);
});
repositoryRoutes.get('/repositories/:id/stage-ages', (req, res, next) => {
  getStageAges(req, res, next).catch(next);
});

// Planning: milestone da Feature com cascata (Stories/Bugs filhos), estimativa
// manual e metadados batch das estimativas.
repositoryRoutes.patch('/repositories/:id/workitems/feature/:number/milestone', (req, res, next) => {
  patchFeatureMilestone(req, res, next).catch(next);
});
repositoryRoutes.patch('/repositories/:id/workitems/feature/:number/estimate', (req, res, next) => {
  patchFeatureEstimate(req, res, next).catch(next);
});
repositoryRoutes.get('/repositories/:id/estimates-meta', (req, res, next) => {
  getEstimatesMeta(req, res, next).catch(next);
});

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

// Tela Specification do PM: versões/status do spec.md, triagem de comentários
// de revisão (marcador <!-- spec-review -->) e aprovação/retorno.
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/spec/meta', (req, res, next) => {
  getFeatureSpecMeta(req, res, next).catch(next);
});
repositoryRoutes.get(
  '/repositories/:id/workitems/feature/:number/spec/blob/:sha',
  (req, res, next) => {
    getFeatureSpecBlob(req, res, next).catch(next);
  },
);
repositoryRoutes.get(
  '/repositories/:id/workitems/feature/:number/spec/status',
  (req, res, next) => {
    getFeatureSpecStatus(req, res, next).catch(next);
  },
);
repositoryRoutes.get(
  '/repositories/:id/workitems/feature/:number/review-comments',
  (req, res, next) => {
    getFeatureReviewComments(req, res, next).catch(next);
  },
);
repositoryRoutes.patch(
  '/repositories/:id/workitems/feature/:number/review-comments/:commentId',
  (req, res, next) => {
    patchReviewCommentTriage(req, res, next).catch(next);
  },
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/review-comments/reply',
  (req, res, next) => {
    postReviewCommentReply(req, res, next).catch(next);
  },
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/spec/approve',
  (req, res, next) => {
    postSpecApprove(req, res, next).catch(next);
  },
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/return-to-prioritization',
  (req, res, next) => {
    postReturnToPrioritization(req, res, next).catch(next);
  },
);

// Revisão técnica do TL (Backlog view do Tech Leader): rascunhos staged,
// devolução ao PM, ciclo de re-revisão, status do plan e pré-review por IA.
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/review-drafts', (req, res, next) => {
  getReviewDrafts(req, res, next).catch(next);
});
repositoryRoutes.post('/repositories/:id/workitems/feature/:number/review-drafts', (req, res, next) => {
  postReviewDraft(req, res, next).catch(next);
});
repositoryRoutes.patch(
  '/repositories/:id/workitems/feature/:number/review-drafts/:draftId',
  (req, res, next) => {
    patchReviewDraft(req, res, next).catch(next);
  },
);
repositoryRoutes.delete(
  '/repositories/:id/workitems/feature/:number/review-drafts/:draftId',
  (req, res, next) => {
    deleteReviewDraftHandler(req, res, next).catch(next);
  },
);
repositoryRoutes.post('/repositories/:id/workitems/feature/:number/return-to-pm', (req, res, next) => {
  postReturnToPm(req, res, next).catch(next);
});
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/review-cycle', (req, res, next) => {
  getReviewCycleHandler(req, res, next).catch(next);
});
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/plan/status', (req, res, next) => {
  getFeaturePlanStatus(req, res, next).catch(next);
});
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/pre-review', (req, res, next) => {
  getPreReviewHandler(req, res, next).catch(next);
});
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/pre-review/run',
  (req, res, next) => {
    postPreReviewRun(req, res, next).catch(next);
  },
);

// Plan view do TL: meta/blob do plan.md, validação (validate.yml) e decomposição
// em duas fases (proposta LLM + materialização idempotente via API).
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/plan/meta', (req, res, next) => {
  getFeaturePlanMeta(req, res, next).catch(next);
});
repositoryRoutes.get(
  '/repositories/:id/workitems/feature/:number/plan/blob/:sha',
  (req, res, next) => {
    getFeaturePlanBlob(req, res, next).catch(next);
  },
);
repositoryRoutes.get('/repositories/:id/plan-validation', (req, res, next) => {
  getPlanValidationHandler(req, res, next).catch(next);
});
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/decomposition/generate',
  (req, res, next) => {
    postDecompositionGenerate(req, res, next).catch(next);
  },
);
repositoryRoutes.get('/repositories/:id/workitems/feature/:number/decomposition', (req, res, next) => {
  getDecomposition(req, res, next).catch(next);
});
repositoryRoutes.patch(
  '/repositories/:id/workitems/feature/:number/decomposition',
  (req, res, next) => {
    patchDecomposition(req, res, next).catch(next);
  },
);
repositoryRoutes.post(
  '/repositories/:id/workitems/feature/:number/decomposition/materialize',
  (req, res, next) => {
    postDecompositionMaterialize(req, res, next).catch(next);
  },
);

// POST /api/repositories/:id/ai/summary → AI insight/summary de um escopo
// (pm-progress | tech-insights | dev-daily | brainstorm). Consome cota de
// refine, salvo tenant com chave OpenRouter própria.
repositoryRoutes.post('/repositories/:id/ai/summary', postRepositoryInsight);
