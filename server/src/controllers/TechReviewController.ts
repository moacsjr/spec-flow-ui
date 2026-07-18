// Controllers da revisão técnica do TL (Backlog view do Tech Leader):
// rascunhos staged, devolução ao PM, ciclo de re-revisão, status do plan e
// pré-review por IA.

import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { isValidRepoId } from '../lib/validation.ts';
import { tenantOf } from '../middleware/auth.ts';
import {
  createDraft,
  getOrStartPreReview,
  getPlanStatus,
  getPlanValidation,
  getReviewCycleView,
  listDrafts,
  removeDraft,
  rerunPreReview,
  returnToPm,
  updateDraft,
} from '../services/techReviewService.ts';
import {
  getProposalFor,
  saveProposalStories,
  startGenerateProposal,
  startMaterialize,
} from '../services/decompositionService.ts';
import type { ProposalStory } from '../db/dynamo.ts';

function paramsOr400(req: Request, res: Response): { repoId: string; n: number } | null {
  const { id, number } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return null;
  }
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) {
    res.status(400).json({ error: `Número inválido: "${number}".` });
    return null;
  }
  return { repoId: id, n };
}

function handle(res: Response, next: NextFunction, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// GET .../feature/:number/review-drafts → { drafts }
export async function getReviewDrafts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    const drafts = await listDrafts(tenantOf(req).tenantId, p.repoId, p.n);
    res.json({
      drafts: drafts.map((d) => ({
        draftId: d.draftId,
        body: d.body,
        anchor: d.anchor,
        specSha: d.specSha,
        createdAt: d.createdAt,
      })),
    });
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/review-drafts → { body, anchor?, specSha? }
export async function postReviewDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    res.status(400).json({ error: 'Informe o corpo do rascunho.' });
    return;
  }
  if (body.specSha !== undefined && body.specSha !== null && typeof body.specSha !== 'string') {
    res.status(400).json({ error: 'specSha deve ser texto ou null.' });
    return;
  }
  try {
    const draft = await createDraft(tenantOf(req).tenantId, p.repoId, p.n, {
      body: body.body.trim(),
      anchor: body.anchor,
      specSha: (body.specSha as string | null | undefined) ?? null,
    });
    res.status(201).json({ draftId: draft.draftId, createdAt: draft.createdAt });
  } catch (err) {
    handle(res, next, err);
  }
}

// PATCH .../review-drafts/:draftId → { body }
export async function patchReviewDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.body !== 'string' || body.body.trim().length === 0) {
    res.status(400).json({ error: 'Informe o corpo do rascunho.' });
    return;
  }
  try {
    await updateDraft(tenantOf(req).tenantId, p.repoId, p.n, req.params.draftId, body.body.trim());
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// DELETE .../review-drafts/:draftId
export async function deleteReviewDraftHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    await removeDraft(tenantOf(req).tenantId, p.repoId, p.n, req.params.draftId);
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/return-to-pm → resultado por passo
export async function postReturnToPm(req: Request, res: Response, next: NextFunction): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await returnToPm(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/review-cycle → ciclo mais recente (ou null)
export async function getReviewCycleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json({ cycle: await getReviewCycleView(tenantOf(req).tenantId, p.repoId, p.n) });
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/plan/status → { hasPlan, latestRun }
export async function getFeaturePlanStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    res.json(await getPlanStatus(tenantOf(req).tenantId, p.repoId, p.n));
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/pre-review → registro (sem registro: inicia e devolve pending)
export async function getPreReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    const rec = await getOrStartPreReview(tenantOf(req).tenantId, p.repoId, p.n);
    res.json({ status: rec.status, specSha: rec.specSha, findings: rec.findings, error: rec.error });
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/pre-review/run → re-execução manual (substitui achados)
export async function postPreReviewRun(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    const rec = await rerunPreReview(tenantOf(req).tenantId, p.repoId, p.n);
    res.status(202).json({ status: rec.status });
  } catch (err) {
    handle(res, next, err);
  }
}


// GET /repositories/:id/plan-validation → { latestRun, report } (validate.yml)
export async function getPlanValidationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { id } = req.params;
  if (!isValidRepoId(id)) {
    res.status(400).json({ error: `Repositório inválido: "${id}".` });
    return;
  }
  try {
    res.json(await getPlanValidation(tenantOf(req).tenantId, id));
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/decomposition/generate → 202 (gera/regenera a proposta)
export async function postDecompositionGenerate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    await startGenerateProposal(tenantOf(req).tenantId, p.repoId, p.n);
    res.status(202).json({ status: 'pending' });
  } catch (err) {
    handle(res, next, err);
  }
}

// GET .../feature/:number/decomposition → { proposal } (ou null)
export async function getDecomposition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    const rec = await getProposalFor(tenantOf(req).tenantId, p.repoId, p.n);
    res.json({
      proposal: rec
        ? {
            planSha: rec.planSha,
            status: rec.status,
            stories: rec.stories,
            error: rec.error,
            updatedAt: rec.updatedAt,
          }
        : null,
    });
  } catch (err) {
    handle(res, next, err);
  }
}

// PATCH .../feature/:number/decomposition → { stories } (edições do TL)
export async function patchDecomposition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(body.stories)) {
    res.status(400).json({ error: 'stories deve ser uma lista.' });
    return;
  }
  try {
    await saveProposalStories(
      tenantOf(req).tenantId,
      p.repoId,
      p.n,
      body.stories as ProposalStory[],
    );
    res.status(204).end();
  } catch (err) {
    handle(res, next, err);
  }
}

// POST .../feature/:number/decomposition/materialize → 202 (inicia/retoma)
export async function postDecompositionMaterialize(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const p = paramsOr400(req, res);
  if (!p) return;
  try {
    await startMaterialize(tenantOf(req).tenantId, p.repoId, p.n);
    res.status(202).json({ status: 'materializing' });
  } catch (err) {
    handle(res, next, err);
  }
}
