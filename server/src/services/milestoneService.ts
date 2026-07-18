// Milestones do repositório (RFC-003, Planning). GitHub Milestones é a fonte de
// verdade — nada é persistido localmente; toda escrita invalida o snapshot.

import type { MilestoneSummary } from '@spec-flow/shared';
import {
  createMilestone,
  deleteMilestone,
  fetchIssueTitle,
  listMilestones,
  setIssueMilestone,
  updateMilestone,
  type GitHubConfig,
} from '../github/client.ts';
import type { GhMilestoneSummary } from '../github/types.ts';
import { HttpError } from '../lib/errors.ts';
import { invalidateSnapshot } from '../lib/snapshotCache.ts';
import { configForRepository, getRepositoryOr404 } from './repositoryService.ts';
import { loadSnapshotForRepository } from './snapshotService.ts';

function toSummary(m: GhMilestoneSummary): MilestoneSummary {
  return {
    number: m.number,
    title: m.title,
    dueOn: m.dueOn,
    state: m.state,
    openCount: m.openIssues,
    closedCount: m.closedIssues,
    description: m.description,
  };
}

async function configFor(tenantId: string, repoId: string): Promise<GitHubConfig> {
  return configForRepository(await getRepositoryOr404(tenantId, repoId));
}

export async function listMilestonesForRepository(
  tenantId: string,
  repoId: string,
): Promise<MilestoneSummary[]> {
  const config = await configFor(tenantId, repoId);
  return (await listMilestones(config)).map(toSummary);
}

export async function createMilestoneForRepository(
  tenantId: string,
  repoId: string,
  input: { title: string; dueOn?: string | null; description?: string },
): Promise<MilestoneSummary> {
  const config = await configFor(tenantId, repoId);
  const created = await createMilestone(config, {
    title: input.title,
    dueOn: input.dueOn,
    description: input.description,
  });
  invalidateSnapshot(tenantId, repoId);
  return toSummary(created);
}

export async function updateMilestoneForRepository(
  tenantId: string,
  repoId: string,
  milestoneNumber: number,
  patch: { title?: string; dueOn?: string | null; state?: 'open' | 'closed'; description?: string },
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await updateMilestone(config, milestoneNumber, patch);
  invalidateSnapshot(tenantId, repoId);
}

export async function deleteMilestoneForRepository(
  tenantId: string,
  repoId: string,
  milestoneNumber: number,
): Promise<void> {
  const config = await configFor(tenantId, repoId);
  await deleteMilestone(config, milestoneNumber);
  invalidateSnapshot(tenantId, repoId);
}

// Atribui/remove (null) o milestone de uma FEATURE com cascata para as Stories
// e Bugs filhos (tela Planning). Tasks herdam via Story — não recebem milestone
// próprio. Sequencial; falha parcial REVERTE a Feature inteira (feature + filhos
// já alterados voltam ao milestone original) e informa o resultado por sub-item.
export interface CascadeItemResult {
  number: number;
  ok: boolean;
  error?: string;
}

export async function setFeatureMilestoneForRepository(
  tenantId: string,
  repoId: string,
  featureNumber: number,
  milestoneNumber: number | null,
): Promise<{ ok: boolean; results: CascadeItemResult[] }> {
  const config = await configFor(tenantId, repoId);
  const snapshot = await loadSnapshotForRepository(tenantId, repoId);

  const feature = snapshot.items.find((i) => i.number === featureNumber);
  if (!feature) throw new HttpError(404, `Feature #${featureNumber} não encontrada.`);
  const originalMilestone = feature.milestone?.number ?? null;

  const children = snapshot.items.filter(
    (i) =>
      i.parentNumber === featureNumber &&
      i.state === 'open' &&
      (i.labels.includes('[STORY]') || i.labels.includes('[BUG]')),
  );

  const targets = [featureNumber, ...children.map((c) => c.number)];
  const results: CascadeItemResult[] = [];
  const applied: number[] = [];

  for (const n of targets) {
    try {
      await setIssueMilestone(config, n, milestoneNumber);
      applied.push(n);
      results.push({ number: n, ok: true });
    } catch (err) {
      results.push({ number: n, ok: false, error: (err as Error).message });
      // Reverte tudo o que já foi aplicado (feature inteira volta ao original).
      for (const done of applied) {
        try {
          await setIssueMilestone(config, done, originalMilestone);
        } catch {
          /* revert best-effort */
        }
      }
      invalidateSnapshot(tenantId, repoId);
      return { ok: false, results };
    }
  }

  invalidateSnapshot(tenantId, repoId);
  return { ok: true, results };
}

// Atribui/remove (null) o milestone de uma Story. Regra do RFC-003: milestones
// contêm SOMENTE User Stories — o título da issue precisa ter o prefixo [STORY]
// (convenção do spec-flow); outros níveis são rejeitados com 422.
export async function setStoryMilestoneForRepository(
  tenantId: string,
  repoId: string,
  storyNumber: number,
  milestoneNumber: number | null,
): Promise<void> {
  const config = await configFor(tenantId, repoId);

  const title = await fetchIssueTitle(config, storyNumber);
  if (!/^\s*\[STORY\]/i.test(title)) {
    throw new HttpError(
      422,
      `A issue #${storyNumber} não é uma User Story — milestones aceitam apenas Stories (RFC-003).`,
    );
  }

  await setIssueMilestone(config, storyNumber, milestoneNumber);
  invalidateSnapshot(tenantId, repoId);
}
