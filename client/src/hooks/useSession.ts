import { useCallback, useEffect, useState } from 'react';
import { authEnabled, clearLocalSession, getIdToken, revokeSession } from '../auth/cognito';

// Estado da sessão do usuário para a UI (Story #66 / Task #69).
//
// Deriva o usuário autenticado do id token do Cognito (claims do JWT). Em dev
// local (auth desabilitada), a sessão é garantida pelo backend via DEV_TENANT_ID
// e não há token no client — nesse caso expomos um usuário genérico de dev.

export interface SessionUser {
  name: string;
  email?: string;
  avatarUrl: string | null;
}

export interface Session {
  authenticated: boolean;
  user: SessionUser | null;
  /**
   * Encerra a sessão (Story #74): revoga o refresh token no Cognido (invalidação
   * server-side) e limpa o estado local de autenticação. O estado local é sempre
   * limpo — mesmo se a revogação falhar — para evitar sessão inconsistente; nesse
   * caso a Promise é rejeitada para o chamador informar o usuário. Não redireciona:
   * o componente decide (ver `redirectToLogout`).
   */
  logout: () => Promise<void>;
}

// Decodifica o payload (2ª parte) de um JWT sem validar assinatura — a
// validação real acontece no authorizer do API Gateway.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function userFromIdToken(token: string): SessionUser {
  const claims = decodeJwtPayload(token) ?? {};

  const email = str(claims.email);
  const fullName = [str(claims.given_name), str(claims.family_name)].filter(Boolean).join(' ');
  const name =
    str(claims.name) ||
    fullName ||
    email?.split('@')[0] ||
    str(claims['cognito:username']) ||
    'Usuário';

  return {
    name,
    email,
    avatarUrl: str(claims.picture) ?? null,
  };
}

type SessionState = Pick<Session, 'authenticated' | 'user'>;

export function useSession(): Session {
  const [state, setState] = useState<SessionState>({ authenticated: false, user: null });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!authEnabled) {
        // Dev local: sessão válida sem token; nome genérico só para a UI.
        if (!cancelled) {
          setState({ authenticated: true, user: { name: 'Dev User', avatarUrl: null } });
        }
        return;
      }

      const token = await getIdToken();
      if (cancelled) return;

      setState(
        token
          ? { authenticated: true, user: userFromIdToken(token) }
          : { authenticated: false, user: null },
      );
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  // Logout seguro (Task #75): revoga no servidor e limpa o estado local. O bloco
  // finally garante que o estado local seja sempre limpo, mesmo se a revogação
  // lançar — assim a UI nunca fica presa em um estado "meio autenticado". A
  // exceção da revogação é repropagada para o componente tratar (Task #77).
  const logout = useCallback(async () => {
    try {
      await revokeSession();
    } finally {
      clearLocalSession();
      setState({ authenticated: false, user: null });
    }
  }, []);

  return { ...state, logout };
}
