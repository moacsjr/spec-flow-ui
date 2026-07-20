// Dados da conta (fase 3): billing/uso, time/convites e configurações.

import { apiFetch } from './apiFetch';

export interface BillingSummary {
  plan: string;
  refinesUsed: number;
  refinesLimit: number;
  reposUsed: number;
  reposLimit: number;
  membersLimit: number;
  ownOpenrouterKey: boolean;
  role: 'owner' | 'member';
}

export interface TeamMember {
  sub: string;
  email: string;
  role: string;
}

export interface TeamInvite {
  code: string;
  email: string;
  role: string;
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${fallback} (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

export async function fetchBilling(): Promise<BillingSummary> {
  return jsonOrThrow(await apiFetch('/api/billing'), 'Falha ao carregar o plano');
}

// Redireciona ao Stripe (checkout ou portal).
export async function openBilling(kind: 'checkout' | 'portal'): Promise<void> {
  const res = await apiFetch(`/api/billing/${kind}`, { method: 'POST' });
  const { url } = await jsonOrThrow<{ url: string }>(res, 'Falha ao abrir o billing');
  window.location.assign(url);
}

export async function fetchTeam(): Promise<{ members: TeamMember[]; invites: TeamInvite[] }> {
  return jsonOrThrow(await apiFetch('/api/team'), 'Falha ao carregar o time');
}

export async function createInvite(email: string, role: 'member' | 'owner'): Promise<TeamInvite> {
  const res = await apiFetch('/api/team/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  return jsonOrThrow(res, 'Falha ao criar o convite');
}

export async function acceptInvite(code: string): Promise<void> {
  const res = await apiFetch('/api/team/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  await jsonOrThrow(res, 'Falha ao aceitar o convite');
}

export async function saveOpenrouterKey(key: string): Promise<void> {
  const res = await apiFetch('/api/settings/openrouter-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  await jsonOrThrow(res, 'Falha ao salvar a chave');
}

// ---- Papéis de acesso (administração — owner/root) ----

export interface RoleMember {
  sub: string;
  email: string;
  role: string; // owner | member (billing)
  githubLogin: string | null;
}

export interface RoleAssignment {
  sub: string;
  repoId: string;
  roles: string[]; // pm | tech | dev
}

export async function fetchRoles(): Promise<{ members: RoleMember[]; assignments: RoleAssignment[] }> {
  return jsonOrThrow(await apiFetch('/api/roles'), 'Falha ao carregar os papéis');
}

export async function putRoles(
  sub: string,
  repoId: string,
  roles: string[],
): Promise<{ warning: string | null }> {
  return jsonOrThrow(
    await apiFetch(`/api/roles/${encodeURIComponent(sub)}/${encodeURIComponent(repoId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles }),
    }),
    'Falha ao gravar os papéis',
  );
}
