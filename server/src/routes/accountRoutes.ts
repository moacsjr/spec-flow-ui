// Rotas de conta (fase 3): billing, time/convites e configurações do tenant.
// Todas autenticadas; as de mutação sensível exigem owner (requireOwner).

import { Router, type NextFunction, type Request, type Response } from 'express';
import { HttpError } from '../lib/errors.ts';
import { requireOwner, tenantOf } from '../middleware/auth.ts';
import { usageSummary } from '../services/quotaService.ts';
import { createCheckoutSession, createPortalSession } from '../services/billingService.ts';
import { acceptInvite, createInvite, teamOverview } from '../services/teamService.ts';
import {
  hasTenantOpenrouterKey,
  setTenantOpenrouterKey,
} from '../services/settingsService.ts';
import { getUserPref, putUserPref } from '../db/dynamo.ts';

export const accountRoutes = Router();

function handleError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  next(err);
}

// ---------- Identidade (workspace do Developer) ----------
// A sessão autentica um usuário Cognito; o "eu" das views do dev é um login do
// GitHub, vinculado uma vez por usuário (persistido no tenant). O acesso ao
// GitHub é via installation token do App (não há OAuth de usuário), então o
// login não é descoberto automaticamente — o dev escolhe o seu na primeira vez.

// GET /api/me → { login, slackUserId, email }
accountRoutes.get('/me', (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  getUserPref(tenant.tenantId, tenant.sub)
    .then((pref) =>
      res.json({
        login: pref?.githubLogin ?? null,
        slackUserId: pref?.slackUserId ?? null,
        email: tenant.email ?? null,
      }),
    )
    .catch((err) => handleError(err, res, next));
});

// PUT /api/me { login?, slackUserId? } → grava as preferências do usuário
// ('' ou null limpa; campo omitido é mantido).
accountRoutes.put('/me', (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  const readField = (raw: unknown, label: string): string | null | undefined => {
    if (raw === undefined) return undefined;
    if (raw !== null && typeof raw !== 'string') {
      res.status(400).json({ error: `${label} deve ser um texto (vazio para limpar).` });
      return undefined;
    }
    const v = typeof raw === 'string' ? raw.trim() : '';
    return v || null;
  };

  const login = readField(body.login, 'login');
  if (res.headersSent) return;
  const slackUserId = readField(body.slackUserId, 'slackUserId');
  if (res.headersSent) return;
  if (login === undefined && slackUserId === undefined) {
    res.status(400).json({ error: 'Informe login e/ou slackUserId.' });
    return;
  }
  if (login && !/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/.test(login)) {
    res.status(400).json({ error: `Login do GitHub inválido: "${login}".` });
    return;
  }
  if (slackUserId && !/^[UW][A-Z0-9]{2,20}$/.test(slackUserId)) {
    res.status(400).json({ error: `Slack member ID inválido: "${slackUserId}" (formato U0XXXXXXX).` });
    return;
  }

  getUserPref(tenant.tenantId, tenant.sub)
    .then((prev) => {
      const next = {
        tenantId: tenant.tenantId,
        sub: tenant.sub,
        githubLogin: login === undefined ? (prev?.githubLogin ?? null) : login,
        slackUserId: slackUserId === undefined ? (prev?.slackUserId ?? null) : slackUserId,
        updatedAt: new Date().toISOString(),
      };
      return putUserPref(next).then(() =>
        res.json({ login: next.githubLogin, slackUserId: next.slackUserId }),
      );
    })
    .catch((err) => handleError(err, res, next));
});

// ---------- Billing ----------

// GET /api/billing → plano + uso do mês (tela de Configurações).
accountRoutes.get('/billing', (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  Promise.all([usageSummary(tenant.tenantId), hasTenantOpenrouterKey(tenant.tenantId)])
    .then(([usage, ownOpenrouterKey]) => res.json({ ...usage, ownOpenrouterKey, role: tenant.role }))
    .catch((err) => handleError(err, res, next));
});

// POST /api/billing/checkout → URL do Stripe Checkout (upgrade → pro).
accountRoutes.post(
  '/billing/checkout',
  requireOwner,
  (req: Request, res: Response, next: NextFunction) => {
    const tenant = tenantOf(req);
    createCheckoutSession(tenant.tenantId, tenant.email)
      .then((url) => res.json({ url }))
      .catch((err) => handleError(err, res, next));
  },
);

// POST /api/billing/portal → URL do Customer Portal (gerenciar/cancelar).
accountRoutes.post(
  '/billing/portal',
  requireOwner,
  (req: Request, res: Response, next: NextFunction) => {
    createPortalSession(tenantOf(req).tenantId)
      .then((url) => res.json({ url }))
      .catch((err) => handleError(err, res, next));
  },
);

// ---------- Time / convites ----------

// GET /api/team → membros + convites pendentes.
accountRoutes.get('/team', (req: Request, res: Response, next: NextFunction) => {
  teamOverview(tenantOf(req).tenantId)
    .then((team) => res.json(team))
    .catch((err) => handleError(err, res, next));
});

// POST /api/team/invites { email, role? } → cria convite (owner).
accountRoutes.post(
  '/team/invites',
  requireOwner,
  (req: Request, res: Response, next: NextFunction) => {
    const tenant = tenantOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email.trim())) {
      res.status(400).json({ error: 'Informe um email válido.' });
      return;
    }
    const role = body.role === 'owner' ? 'owner' : 'member';
    createInvite(tenant.tenantId, tenant.sub, body.email, role)
      .then((invite) => res.status(201).json({ code: invite.code, email: invite.email, role }))
      .catch((err) => handleError(err, res, next));
  },
);

// POST /api/team/invites/accept { code } → entra no tenant convidante.
// Aberto a qualquer autenticado (o convidado ainda pertence ao tenant do signup).
accountRoutes.post(
  '/team/invites/accept',
  (req: Request, res: Response, next: NextFunction) => {
    const tenant = tenantOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.code !== 'string' || body.code.length === 0) {
      res.status(400).json({ error: 'Informe o código do convite.' });
      return;
    }
    acceptInvite(body.code, { sub: tenant.sub, email: tenant.email })
      .then((r) => res.json(r))
      .catch((err) => handleError(err, res, next));
  },
);

// ---------- Configurações ----------

// PUT /api/settings/openrouter-key { key } → chave própria do tenant ('' remove).
accountRoutes.put(
  '/settings/openrouter-key',
  requireOwner,
  (req: Request, res: Response, next: NextFunction) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.key !== 'string') {
      res.status(400).json({ error: 'key deve ser um texto (vazio para remover).' });
      return;
    }
    setTenantOpenrouterKey(tenantOf(req).tenantId, body.key.trim())
      .then(() => res.json({ ok: true }))
      .catch((err) => handleError(err, res, next));
  },
);
