// Rotas do onboarding do GitHub App (autenticadas — o tenant vem do JWT):
//   POST /api/github/install-url → { url } para redirecionar à instalação
//   POST /api/github/setup       → conclui o vínculo installation → tenant

import { Router, type NextFunction, type Request, type Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { requireOwner, tenantOf } from '../middleware/auth.ts';
import { completeSetup, createInstallUrl } from '../services/installationService.ts';

export const githubRoutes = Router();

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// Onboarding do GitHub App é administração — restrito ao owner (root).
githubRoutes.post('/github/install-url', requireOwner, (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  createInstallUrl(tenant.tenantId, tenant.sub)
    .then((url) => res.json({ url }))
    .catch((err) => handleError(err, res, next));
});

githubRoutes.post('/github/setup', requireOwner, (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const installationId = Number(body.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    res.status(400).json({ error: 'installationId inválido.' });
    return;
  }
  if (typeof body.state !== 'string' || body.state.length === 0) {
    res.status(400).json({ error: 'state ausente.' });
    return;
  }
  completeSetup(tenant.tenantId, installationId, body.state)
    .then(() => res.json({ ok: true }))
    .catch((err) => handleError(err, res, next));
});
