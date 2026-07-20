// Telas de execução do Tech Leader (Technical Backlog, Development, QA,
// Progress): pontos inline, devolução para Ready, vereditos de QA e o resumo
// narrativo de progresso por milestone.

import {
  addLabel,
  createComment,
  createIssue,
  fetchIssueCommentsFull,
  fetchIssueRef,
  fetchProjectItemId,
  fetchSingleSelectField,
  moveProjectStage,
  setIssueAssignees,
  setIssueMilestone,
  setSubIssueParent,
  updateIssueState,
  type GitHubConfig,
} from '../github/client.ts';
import { getUserPref, queryStageEntries } from '../db/dynamo.ts';
import { generateText } from '../llm/openrouter.ts';
import { HttpError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { actorLogin } from '../lib/actor.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { consumeRefineOrThrow } from './quotaService.ts';
import { tenantOpenrouterKey } from './settingsService.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { setStageForRepository, stageAgesForRepository } from './workItemService.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';
import { archiveDiscussionForFeature } from './discussionService.ts';

const FIB = [1, 2, 3, 5, 8, 13, 21];
const QA_RETURN_MARKER = '<!-- qa-return -->';
const UAT_RETURN_MARKER = '<!-- uat-return -->';
// Label de registro do fechamento automático da Feature (regra D4).
export const FEATURE_DONE_LABEL = 'spec-wave:feature-done';

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

function typeOfTitle(title: string): 'story' | 'bug' | null {
  const m = title.match(/^\s*\[([A-Z]+)\]/);
  if (m?.[1] === 'STORY') return 'story';
  if (m?.[1] === 'BUG') return 'bug';
  return null;
}

// ---- Story Points inline (Technical Backlog) ----
// Campo single-select do Project: grava a opção mais próxima da escala.
export async function setStoryPointsForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  points: number,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  if (!config.project) throw new HttpError(409, 'Repositório sem Projects v2 vinculado.');
  const itemId = await fetchProjectItemId(config, number, config.project.projectId);
  if (!itemId) throw new HttpError(422, `A issue #${number} não está no board.`);
  const field = await fetchSingleSelectField(config, config.project.projectId, 'Story Points');
  if (!field) throw new HttpError(422, 'O board não tem o campo "Story Points".');
  const target = FIB.reduce((b, f) => (Math.abs(f - points) < Math.abs(b - points) ? f : b), FIB[0]);
  const optionId = field.options[String(target)];
  if (!optionId) throw new HttpError(422, `O campo Story Points não tem a opção "${target}".`);
  await moveProjectStage(config, config.project.projectId, itemId, field.id, optionId);
  invalidateSnapshot(tenantId, repoId);
}

// ---- Start Story (Pending do Developer) ----
// Pull: atribui o usuário da sessão (login do GitHub vinculado em /api/me) como
// responsável e move a etapa para Desenvolvimento (transição manual).
export async function startWorkForRepository(
  tenantId: string,
  sub: string,
  repoId: string,
  number: number,
): Promise<{ login: string }> {
  const pref = await getUserPref(tenantId, sub);
  const login = pref?.githubLogin ?? null;
  if (!login) {
    throw new HttpError(
      409,
      'Defina o seu login do GitHub no workspace do Developer antes de puxar um item.',
    );
  }
  const config = await configFor(tenantId, repoId);
  await setIssueAssignees(config, number, [login]);
  await setStageForRepository(tenantId, repoId, number, 'Development', 'manual');
  invalidateSnapshot(tenantId, repoId);
  return { login };
}

// ---- Tasks checáveis (In Progress do Developer) ----
// Marcar fecha a issue da Task; desmarcar reabre. O progresso {k}/{t} sobe em
// cascata via subIssuesSummary do GitHub (nada a persistir aqui).
export async function setTaskStateForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  done: boolean,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  const ref = await fetchIssueRef(config, number);
  if (!/^\s*\[TASK\]/.test(ref.title)) {
    throw new HttpError(422, `A issue #${number} não é uma Task.`);
  }
  await updateIssueState(config, number, done ? 'closed' : 'open');
  invalidateSnapshot(tenantId, repoId);
}

// ---- Retorno de QA/Homologação (badge no card do In Progress) ----
// O motivo vive no último comentário com um dos marcadores de retorno (qa-return
// do TL ou uat-return do PM — a origem identifica quem reprovou). O badge vale
// para o ciclo atual de Desenvolvimento: comentário anterior à entrada corrente
// na etapa (com tolerância — o comentário é postado ANTES do movimento) é ciclo
// antigo e não conta.
const QA_RETURN_TOLERANCE_MS = 10 * 60_000;

// Os marcadores podem carregar autoria: `<!-- qa-return {"author":"x"} -->`.
const RETURN_MARKER_RE = /<!--\s*(qa|uat)-return(\s+\{[\s\S]*?\})?\s*-->/;

export async function qaReturnInfoForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<{ reason: string; at: string; origin: 'qa' | 'uat' } | null> {
  const config = await configFor(tenantId, repoId);
  const comments = await fetchIssueCommentsFull(config, number);
  const returns = comments.filter((c) => RETURN_MARKER_RE.test(c.body));
  const last = returns[returns.length - 1];
  if (!last) return null;

  const entries = await queryStageEntries(tenantId, repoId, 'Development').catch(() => []);
  const entry = entries.find((e) => e.issueNumber === number);
  if (
    entry &&
    Date.parse(last.createdAt) < Date.parse(entry.at) - QA_RETURN_TOLERANCE_MS
  ) {
    return null; // retorno de um ciclo anterior — o item já saiu e voltou depois
  }

  const origin: 'qa' | 'uat' = last.body.match(RETURN_MARKER_RE)?.[1] === 'uat' ? 'uat' : 'qa';
  const reason = last.body
    .replace(RETURN_MARKER_RE, '')
    .replace(/\*\*Retorno (de QA|da Homologação)[^:]*:\*\*/, '')
    .trim();
  return { reason, at: last.createdAt, origin };
}

// ---- Devolver para Ready (Development) ----
// Pull por engano / indisponibilidade: limpa o responsável e volta a etapa.
export async function returnToReadyForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await setIssueAssignees(config, number, []);
  await setStageForRepository(tenantId, repoId, number, 'Ready');
  invalidateSnapshot(tenantId, repoId);
}

// ---- Vereditos de QA ----

// Approve roteado por tipo: Story → Homologação (UAT); Bug → Done direto
// (correção técnica não tem validação de negócio — decisão da spec).
export async function qaApproveForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<{ movedTo: 'UAT' | 'Done' }> {
  const config = await configFor(tenantId, repoId);
  const ref = await fetchIssueRef(config, number);
  const type = typeOfTitle(ref.title);
  if (!type) throw new HttpError(422, `A issue #${number} não é Story nem Bug.`);
  const target = type === 'story' ? ('UAT' as const) : ('Done' as const);
  await setStageForRepository(tenantId, repoId, number, target);
  invalidateSnapshot(tenantId, repoId);
  return { movedTo: target };
}

// Return to Development (QA do TL e Homologação do PM — marcadores distintos
// para o dev saber a ORIGEM da reprovação): motivo obrigatório postado como
// comentário com o marcador; responsável preservado. `createBug` cria a issue
// [BUG] vinculada (parent = Story, milestone herdado — regra D5) já em Ready.
async function returnToDevelopment(
  tenantId: string,
  repoId: string,
  number: number,
  reason: string,
  createBug: boolean,
  origin: 'qa' | 'uat',
): Promise<{ bugNumber: number | null }> {
  const config = await configFor(tenantId, repoId);
  // Autoria (spec Gestão de usuários §7): "por @login" no corpo + author no marcador.
  const author = await actorLogin(tenantId);
  const marker = author
    ? `<!-- ${origin}-return ${JSON.stringify({ author })} -->`
    : origin === 'qa'
      ? QA_RETURN_MARKER
      : UAT_RETURN_MARKER;
  const by = author ? ` (por @${author})` : '';
  const prefix = origin === 'qa' ? `**Retorno de QA${by}:**` : `**Retorno da Homologação${by}:**`;
  await createComment(config, number, `${marker}\n\n${prefix} ${reason}`);
  await setStageForRepository(tenantId, repoId, number, 'Development');

  let bugNumber: number | null = null;
  if (createBug) {
    const storyRef = await fetchIssueRef(config, number);
    const snapshot = await loadSnapshotForRepository(tenantId, repoId);
    const story = snapshot.items.find((i) => i.number === number);
    const created = await createIssue(config, {
      title: `[BUG] ${reason.slice(0, 80)}${reason.length > 80 ? '…' : ''}`,
      body: reason,
      labels: ['[BUG]'],
    });
    bugNumber = created.number;
    await setSubIssueParent(config, storyRef.nodeId, created.nodeId);
    if (story?.milestone) {
      await setIssueMilestone(config, created.number, story.milestone.number).catch(() => undefined);
    }
    await setStageForRepository(tenantId, repoId, created.number, 'Ready').catch(() => undefined);
  }

  invalidateSnapshot(tenantId, repoId);
  return { bugNumber };
}

export async function qaReturnForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  reason: string,
  createBug: boolean,
): Promise<{ bugNumber: number | null }> {
  return returnToDevelopment(tenantId, repoId, number, reason, createBug, 'qa');
}

export async function uatReturnForRepository(
  tenantId: string,
  repoId: string,
  number: number,
  reason: string,
  createBug: boolean,
): Promise<{ bugNumber: number | null }> {
  return returnToDevelopment(tenantId, repoId, number, reason, createBug, 'uat');
}

// ---- Aceite de negócio (Homologação do PM) ----

const isDoneItem = (i: { state: string; stage: string | null }): boolean =>
  i.state === 'closed' || i.stage === 'Done';

// Regra D4: a Feature fecha automaticamente quando TODAS as Stories filhas e
// TODOS os Bugs filhos (diretos ou via Stories) estão em Done. Idempotente —
// reavalia a condição e só age quando a Feature ainda está aberta. Exportada
// para a rede de segurança do ciclo de polling (automationService).
export async function featureDoneCheck(
  tenantId: string,
  repoId: string,
  featureNumber: number,
): Promise<boolean> {
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);
  const feature = snapshot.items.find((i) => i.number === featureNumber);
  if (!feature || feature.state !== 'open' || !feature.labels.includes('[FEATURE]')) return false;

  const stories = snapshot.items.filter(
    (i) => i.parentNumber === featureNumber && i.labels.includes('[STORY]'),
  );
  if (stories.length === 0) return false; // Feature sem Stories não fecha sozinha
  const storyNumbers = new Set(stories.map((s) => s.number));
  const bugs = snapshot.items.filter(
    (i) =>
      i.labels.includes('[BUG]') &&
      i.parentNumber != null &&
      (i.parentNumber === featureNumber || storyNumbers.has(i.parentNumber)),
  );
  if (!stories.every(isDoneItem) || !bugs.every(isDoneItem)) return false;

  const config = await configFor(tenantId, repoId);
  // Etapa Done no board e label de registro são best-effort; o fechamento da
  // issue (com closedAt do GitHub como data registrada) é o ato que conta.
  await setStageForRepository(tenantId, repoId, featureNumber, 'Done', 'automation').catch(
    () => undefined,
  );
  await addLabel(config, featureNumber, FEATURE_DONE_LABEL).catch(() => undefined);
  await updateIssueState(config, featureNumber, 'closed');
  // Discussão integrada: arquiva o canal da Feature no mesmo ato (falha não
  // bloqueia o fechamento — a rede de segurança do polling rearquiva).
  await archiveDiscussionForFeature(tenantId, repoId, featureNumber).catch((err: Error) =>
    logger.warn(`Feature #${featureNumber}: canal de discussão não arquivado: ${err.message}`),
  );
  invalidateSnapshot(tenantId, repoId);
  return true;
}

// Approve da Homologação: Story → Done + verificação D4 no mesmo ato. Falha na
// verificação NÃO reverte o approve (a rede de segurança do polling reexecuta).
export async function uatApproveForRepository(
  tenantId: string,
  repoId: string,
  number: number,
): Promise<{ featureClosed: boolean; featureNumber: number | null; pendingCheck: boolean }> {
  await setStageForRepository(tenantId, repoId, number, 'Done');
  invalidateSnapshot(tenantId, repoId);

  try {
    const snapshot = await loadSnapshotForRepository(tenantId, repoId, { fresh: true });
    const story = snapshot.items.find((i) => i.number === number);
    const featureNumber = story?.parentNumber ?? null;
    if (featureNumber == null) return { featureClosed: false, featureNumber: null, pendingCheck: false };
    const featureClosed = await featureDoneCheck(tenantId, repoId, featureNumber);
    return { featureClosed, featureNumber, pendingCheck: false };
  } catch (err) {
    logger.warn(
      `Homologação #${number}: approve ok, mas a verificação D4 falhou (reexecuta no polling): ${(err as Error).message}`,
    );
    return { featureClosed: false, featureNumber: null, pendingCheck: true };
  }
}

// ---- Resumo narrativo de progresso por milestone (Progress) ----

const EXEC_STAGES = ['Ready', 'Development', 'Code Review', 'QA', 'UAT', 'Done'] as const;

export async function generateProgressSummary(
  tenantId: string,
  repoId: string,
  milestoneNumber: number,
): Promise<string> {
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);
  const milestone = snapshot.milestones.find((m) => m.number === milestoneNumber);
  if (!milestone) throw new HttpError(404, `Milestone #${milestoneNumber} não encontrado.`);

  const items = snapshot.items.filter(
    (i) =>
      i.milestone?.number === milestoneNumber &&
      (i.labels.includes('[STORY]') || i.labels.includes('[BUG]')),
  );

  // Idades por etapa (best-effort — enriquece o contexto do gargalo).
  const ages = new Map<number, { at: string; approximate: boolean }>();
  for (const stage of EXEC_STAGES) {
    try {
      const list = await stageAgesForRepository(tenantId, repoId, stage);
      for (const a of list) ages.set(a.number, a);
    } catch {
      /* best-effort */
    }
  }

  const tenantKey = await tenantOpenrouterKey(tenantId);
  if (!tenantKey) await consumeRefineOrThrow(tenantId);

  const lines = items.map((i) => {
    const age = ages.get(i.number);
    const days = age ? Math.floor((Date.now() - Date.parse(age.at)) / 86_400_000) : null;
    return [
      `#${i.number}`,
      i.labels.includes('[BUG]') ? '[BUG]' : '[STORY]',
      i.title,
      `etapa=${i.stage ?? '—'}`,
      i.points != null ? `${i.points}pts` : null,
      i.assignees[0] ? `resp=${i.assignees[0].login}` : 'sem-resp',
      days != null ? `${age?.approximate ? '~' : ''}${days}d na etapa` : null,
      i.prs.length ? `PRs=${i.prs.map((p) => `#${p.number}(${p.state})`).join(',')}` : 'sem-PR',
    ]
      .filter(Boolean)
      .join(' | ');
  });

  return generateText({
    system:
      'Você resume o progresso de execução de um milestone para um Tech Leader, em UM parágrafo ' +
      'narrativo e direto (máximo 5 frases), apontando gargalos, filas vazias e itens sem ' +
      'movimento. Sem listas, sem repetir os dados crus. Responda em português.',
    user: [
      `Milestone: ${milestone.title}${milestone.dueOn ? ` (alvo ${milestone.dueOn.slice(0, 10)})` : ''}`,
      `Itens (${lines.length}):`,
      ...lines,
    ].join('\n'),
    apiKeyOverride: tenantKey,
    maxTokens: 350,
  });
}
