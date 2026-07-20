// Multi-usuário por tenant (fase 3): convites e membros.
//
// Convite: owner gera um código (uso único, TTL 7 dias). O convidado cria conta
// normalmente (signup cria um tenant próprio descartável), loga e aceita o
// convite — o vínculo USER#<sub> é REESCRITO para o tenant convidante. O claim
// custom:tenant_id só muda no próximo token → o client força re-login após o
// aceite (ver client/src/pages de convite).

import { randomUUID } from 'node:crypto';
import {
  consumeInvite,
  deleteMember,
  getUser,
  listInvites,
  listMembers,
  putInvite,
  putMember,
  putUser,
  getTenant,
  type InviteRecord,
  type MemberRecord,
} from '../db/dynamo.ts';
import { planLimits } from '../lib/plans.ts';
import { HttpError, NotFoundError } from '../lib/errors.ts';
import { logger } from '../lib/logger.ts';
import { requestContext } from '../lib/requestContext.ts';

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function createInvite(
  tenantId: string,
  invitedBy: string,
  email: string,
  role: 'member' | 'owner',
): Promise<InviteRecord> {
  const tenant = await getTenant(tenantId);
  if (!tenant) throw new NotFoundError('Tenant não encontrado.');

  const [members, invites] = await Promise.all([listMembers(tenantId), listInvites(tenantId)]);
  const limit = planLimits(tenant.plan).maxMembers;
  if (members.length + invites.length >= limit) {
    throw new HttpError(
      402,
      `Limite de ${limit} membros do plano ${tenant.plan} atingido (incluindo convites pendentes).`,
    );
  }

  const invite: InviteRecord = {
    code: randomUUID(),
    tenantId,
    email: email.trim().toLowerCase(),
    role,
    invitedBy,
    createdAt: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS,
  };
  await putInvite(invite);
  return invite;
}

// Aceita um convite: reescreve o vínculo do usuário para o tenant convidante.
// O tenant criado automaticamente no signup do convidado fica órfão (sem dados
// além do META — limpeza é tarefa administrativa futura).
//
// IMPORTANTE: esta é a ÚNICA operação legitimamente CROSS-TENANT do sistema —
// a request roda com o claim do tenant do CONVIDADO, mas escreve chaves do
// tenant CONVIDANTE (MEMBER# e o espelho INVITE#). Com o hardening LeadingKeys
// ativo, o client escopado do request nega essas escritas (meio-aplicado: o
// USER# muda e o MEMBER# não — bug observado em produção). Por isso o aceite
// roda com o client DEFAULT; a autorização aqui é o próprio código de uso
// único do convite.
export async function acceptInvite(
  code: string,
  user: { sub: string; email?: string },
): Promise<{ tenantId: string }> {
  const store = requestContext.getStore();
  if (store?.doc) {
    return requestContext.run({ ...store, doc: undefined }, () => acceptInviteUnscoped(code, user));
  }
  return acceptInviteUnscoped(code, user);
}

async function acceptInviteUnscoped(
  code: string,
  user: { sub: string; email?: string },
): Promise<{ tenantId: string }> {
  const invite = await consumeInvite(code);
  if (!invite) throw new HttpError(403, 'Convite inválido, expirado ou já utilizado.');

  const current = await getUser(user.sub);
  if (current?.tenantId === invite.tenantId) return { tenantId: invite.tenantId }; // idempotente

  const now = new Date().toISOString();
  await putUser({
    sub: user.sub,
    tenantId: invite.tenantId,
    email: user.email ?? invite.email,
    role: invite.role,
    createdAt: current?.createdAt ?? now,
  });
  await putMember({
    sub: user.sub,
    tenantId: invite.tenantId,
    email: user.email ?? invite.email,
    role: invite.role,
    createdAt: now,
  });
  // Remove o espelho de membro do tenant antigo (auto-criado no signup).
  if (current && current.tenantId !== invite.tenantId) {
    await deleteMember(current.tenantId, user.sub).catch(() => {});
  }
  logger.info(`Usuário ${user.sub} entrou no tenant ${invite.tenantId} como ${invite.role}.`);
  return { tenantId: invite.tenantId };
}

export async function teamOverview(
  tenantId: string,
): Promise<{ members: MemberRecord[]; invites: InviteRecord[] }> {
  const [members, invites] = await Promise.all([listMembers(tenantId), listInvites(tenantId)]);
  return { members, invites };
}
