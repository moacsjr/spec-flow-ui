// Automação de etapas por eventos de PR (spec "Workspace do Developer" §2).
// Não há webhooks do GitHub nesta entrega: a detecção acontece no ciclo de
// "polling" já existente — cada snapshot fresh montado dispara uma reconciliação
// best-effort (fire-and-forget no SnapshotController). Idempotente: reavalia o
// estado desejado e só grava diferenças, registrando transições com origem
// `automation`.
//
// Regras (forward-only — a automação NUNCA move para trás):
//   Development → Code Review  quando ≥1 PR aberto (não-draft) com review
//                              solicitado. Adaptação: o snapshot não expõe
//                              reviewRequestedAt; "review solicitado" = há
//                              reviewers designados ou reviewDecision presente,
//                              e a evidência é datada pelo createdAt do PR.
//   Code Review → QA           quando todos os PRs vinculados estão fechados e
//                              ≥1 foi merged.
//   changesRequested           permanece em Code Review (badge no client);
//                              nenhuma regressão automática.
//
// Supressão de movimento manual (spec §2): a automação nunca desfaz um
// movimento manual mais recente. Se a última transição do item é manual e é
// mais recente que a evidência de PR (createdAt), a regra Dev→CR não dispara —
// cobre o retorno de QA com um PR antigo ainda aberto. Um PR NOVO (criado após
// o movimento manual) reabilita a automação.

import type { ProjectSnapshot, SnapshotItem, StageName } from '@spec-flow/shared';
import { queryStageLast, type StageLastRecord } from '../db/dynamo.ts';
import { logger } from '../lib/logger.ts';
import { setStageForRepository } from './workItemService.ts';
import { featureDoneCheck } from './executionService.ts';
import { archiveClosedFeatureDiscussions } from './discussionService.ts';

const THROTTLE_MS = 60_000;

const inFlight = new Set<string>();
const lastRunAt = new Map<string, number>();

const isExecItem = (i: SnapshotItem): boolean =>
  i.labels.includes('[STORY]') || i.labels.includes('[BUG]');

// "Review solicitado" num PR aberto (aproximação — ver cabeçalho).
const reviewRequested = (i: SnapshotItem): { at: string } | null => {
  const hits = i.prs.filter(
    (pr) =>
      pr.state === 'open' &&
      !pr.isDraft &&
      (pr.reviewers.length > 0 || pr.reviewDecision != null),
  );
  if (hits.length === 0) return null;
  const at = hits.map((pr) => pr.createdAt).sort().pop() as string;
  return { at };
};

const allClosedSomeMerged = (i: SnapshotItem): boolean =>
  i.prs.length > 0 &&
  i.prs.every((pr) => pr.state !== 'open') &&
  i.prs.some((pr) => pr.state === 'merged');

function desiredMove(
  item: SnapshotItem,
  last: StageLastRecord | undefined,
): StageName | null {
  if (item.stage === 'Development') {
    const evidence = reviewRequested(item);
    if (!evidence) return null;
    // Movimento manual mais recente que a evidência → o humano decidiu com os
    // PRs atuais à vista; a automação espera evidência nova (PR novo).
    if (last && last.origin === 'manual' && last.at > evidence.at) return null;
    return 'Code Review';
  }
  if (item.stage === 'Code Review' && allClosedSomeMerged(item)) return 'QA';
  return null;
}

// Reconcilia as etapas de execução do repositório a partir do snapshot já
// montado. Best-effort: com guard de reentrância e throttle por repo.
export function maybeReconcileAutomation(
  tenantId: string,
  repoId: string,
  snapshot: ProjectSnapshot,
): void {
  const key = `${tenantId}:${repoId}`;
  const now = Date.now();
  if (inFlight.has(key) || now - (lastRunAt.get(key) ?? 0) < THROTTLE_MS) return;
  inFlight.add(key);
  lastRunAt.set(key, now);

  reconcile(tenantId, repoId, snapshot)
    .catch((err: Error) => {
      logger.warn(`Automação de etapas falhou em ${repoId}: ${err.message}`);
    })
    .finally(() => inFlight.delete(key));
}

async function reconcile(
  tenantId: string,
  repoId: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  await closeCompletedFeatures(tenantId, repoId, snapshot);

  // Rede de segurança da discussão integrada: canais ativos de Features já
  // fechadas (arquivamento do D4 falhou ou a issue fechou por fora).
  const closedFeatures = new Set(
    snapshot.items
      .filter((i) => i.state === 'closed' && i.labels.includes('[FEATURE]'))
      .map((i) => i.number),
  );
  if (closedFeatures.size > 0) {
    await archiveClosedFeatureDiscussions(tenantId, repoId, closedFeatures).catch(() => undefined);
  }

  const candidates = snapshot.items.filter(
    (i) =>
      i.state === 'open' &&
      isExecItem(i) &&
      (i.stage === 'Development' || i.stage === 'Code Review'),
  );
  if (candidates.length === 0) return;

  const lastByNumber = new Map(
    (await queryStageLast(tenantId, repoId).catch(() => [] as StageLastRecord[])).map((r) => [
      r.issueNumber,
      r,
    ]),
  );

  for (const item of candidates) {
    const target = desiredMove(item, lastByNumber.get(item.number));
    if (!target) continue;
    try {
      await setStageForRepository(tenantId, repoId, item.number, target, 'automation');
      logger.info(
        `Automação: #${item.number} ${item.stage} → ${target} (${repoId}) por eventos de PR.`,
      );
    } catch (err) {
      logger.warn(
        `Automação: falha ao mover #${item.number} para ${target}: ${(err as Error).message}`,
      );
    }
  }
}

// Rede de segurança da regra D4: fecha Features completas cujo fechamento no
// ato do Approve falhou (ou cujos Bugs foram concluídos por fora). Os
// candidatos são filtrados no snapshot local; o featureDoneCheck revalida com
// dados frescos antes de agir (idempotente).
const isDone = (i: SnapshotItem): boolean => i.state === 'closed' || i.stage === 'Done';

async function closeCompletedFeatures(
  tenantId: string,
  repoId: string,
  snapshot: ProjectSnapshot,
): Promise<void> {
  const features = snapshot.items.filter(
    (i) => i.state === 'open' && i.labels.includes('[FEATURE]'),
  );
  for (const feature of features) {
    const stories = snapshot.items.filter(
      (i) => i.parentNumber === feature.number && i.labels.includes('[STORY]'),
    );
    if (stories.length === 0 || !stories.every(isDone)) continue;
    const storyNumbers = new Set(stories.map((s) => s.number));
    const bugs = snapshot.items.filter(
      (i) =>
        i.labels.includes('[BUG]') &&
        i.parentNumber != null &&
        (i.parentNumber === feature.number || storyNumbers.has(i.parentNumber)),
    );
    if (!bugs.every(isDone)) continue;
    try {
      const closed = await featureDoneCheck(tenantId, repoId, feature.number);
      if (closed) logger.info(`D4: Feature #${feature.number} fechada automaticamente (${repoId}).`);
    } catch (err) {
      logger.warn(`D4: falha ao fechar a Feature #${feature.number}: ${(err as Error).message}`);
    }
  }
}
