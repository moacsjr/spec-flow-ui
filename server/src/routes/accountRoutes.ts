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
import {
  getUserPref,
  listMembers,
  putAuditLog,
  putMemberRoles,
  putUserPref,
  queryMemberRoles,
} from '../db/dynamo.ts';
import { config } from '../config.ts';
import { isRepoCollaborator } from '../github/client.ts';
import { configForRepository, getRepositoryOr404 } from '../services/repositoryService.ts';

export const accountRoutes = Router();

const WORK_ROLES = ['pm', 'tech', 'dev'] as const;

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

// GET /api/me → identidade + papéis reais por repositório (spec Gestão de
// usuários §2): isRoot = owner do tenant; enforced = modo da instância.
accountRoutes.get('/me', (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  Promise.all([
    getUserPref(tenant.tenantId, tenant.sub),
    queryMemberRoles(tenant.tenantId, tenant.sub),
  ])
    .then(([pref, assignments]) =>
      res.json({
        login: pref?.githubLogin ?? null,
        slackUserId: pref?.slackUserId ?? null,
        email: tenant.email ?? null,
        isRoot: tenant.role === 'owner',
        enforced: config.authEnforced,
        roles: assignments
          .filter((a) => a.roles.length > 0)
          .map((a) => ({ repoId: a.repoId, roles: a.roles })),
      }),
    )
    .catch((err) => handleError(err, res, next));
});

// ---------- Papéis de acesso (administração — owner/root) ----------

// GET /api/roles → matriz membros × repositórios (tela de Configurações).
accountRoutes.get('/roles', requireOwner, (req: Request, res: Response, next: NextFunction) => {
  const tenant = tenantOf(req);
  Promise.all([listMembers(tenant.tenantId), queryMemberRoles(tenant.tenantId)])
    .then(async ([members, assignments]) => {
      const withLogin = await Promise.all(
        members.map(async (m) => ({
          sub: m.sub,
          email: m.email,
          role: m.role,
          githubLogin: (await getUserPref(tenant.tenantId, m.sub).catch(() => null))?.githubLogin ?? null,
        })),
      );
      res.json({
        members: withLogin,
        assignments: assignments.map((a) => ({ sub: a.sub, repoId: a.repoId, roles: a.roles })),
      });
    })
    .catch((err) => handleError(err, res, next));
});

// PUT /api/roles/:sub/:repoId { roles } → atribui os papéis do membro no
// repositório (lista vazia revoga). Concessão de dev a não-collaborator do
// GitHub devolve um aviso não bloqueante. Auditado.
accountRoutes.put(
  '/roles/:sub/:repoId',
  requireOwner,
  (req: Request, res: Response, next: NextFunction) => {
    const tenant = tenantOf(req);
    const { sub, repoId } = req.params;
    const raw = ((req.body ?? {}) as Record<string, unknown>).roles;
    if (
      !Array.isArray(raw) ||
      !raw.every((r) => typeof r === 'string' && (WORK_ROLES as readonly string[]).includes(r))
    ) {
      res.status(400).json({ error: 'roles deve ser uma lista de "pm" | "tech" | "dev".' });
      return;
    }
    const roles = [...new Set(raw as string[])];

    (async () => {
      const record = await getRepositoryOr404(tenant.tenantId, repoId); // 404 se não for do tenant
      const members = await listMembers(tenant.tenantId);
      if (!members.some((m) => m.sub === sub)) {
        res.status(404).json({ error: `Membro "${sub}" não encontrado no tenant.` });
        return;
      }

      const previous = await queryMemberRoles(tenant.tenantId, sub);
      const grantedDev =
        roles.includes('dev') &&
        !previous.some((a) => a.repoId === repoId && a.roles.includes('dev'));

      await putMemberRoles({
        tenantId: tenant.tenantId,
        sub,
        repoId,
        roles,
        updatedAt: new Date().toISOString(),
        updatedBy: tenant.sub,
      });
      await putAuditLog({
        tenantId: tenant.tenantId,
        at: new Date().toISOString(),
        sub: tenant.sub,
        action: 'roles.set',
        target: `${sub}#${repoId}`,
        detail: roles.join(',') || '(revogado)',
      }).catch(() => undefined);

      // Aviso de collaborator (best-effort — spec §5.2): só na concessão de dev.
      let warning: string | null = null;
      if (grantedDev) {
        const login = (await getUserPref(tenant.tenantId, sub).catch(() => null))?.githubLogin;
        if (login) {
          const isCollab = await isRepoCollaborator(await configForRepository(record), login).catch(
            () => true, // indisponível → sem aviso (não bloqueante)
          );
          if (!isCollab) {
            warning = `@${login} não é collaborator de ${record.name} — não poderá ser assignee de issues.`;
          }
        } else {
          warning =
            'O membro ainda não vinculou o login do GitHub — o pull de itens exigirá o vínculo.';
        }
      }
      res.json({ sub, repoId, roles, warning });
    })().catch((err) => handleError(err, res, next));
  },
);

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
