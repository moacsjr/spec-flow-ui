// Autenticação via Cognito Hosted UI (authorization code + PKCE), sem
// dependência externa (Web Crypto). O client é uma SPA pública: nenhum segredo
// aqui — a validação do JWT acontece no JWT authorizer do API Gateway.
//
// Config via env do Vite (definida no build pela infra):
//   VITE_COGNITO_DOMAIN    ex.: https://spec-wave.auth.us-east-1.amazoncognito.com
//   VITE_COGNITO_CLIENT_ID app client (sem secret, com PKCE)
// Sem essas vars (dev local), a auth fica DESABILITADA e o backend usa
// DEV_TENANT_ID — nada de token no request.

const DOMAIN = (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined) ?? '';
const CLIENT_ID = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? '';

const STORAGE_KEY = 'spec-wave.auth';
const PKCE_KEY = 'spec-wave.pkce';

interface StoredTokens {
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

export const authEnabled = Boolean(DOMAIN && CLIENT_ID);

const redirectUri = () => `${window.location.origin}/`;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function loadTokens(): StoredTokens | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTokens) : null;
  } catch {
    return null;
  }
}

function saveTokens(t: StoredTokens): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

// Redireciona para o login do Hosted UI (code + PKCE).
export async function login(): Promise<void> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = b64url(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = b64url(new Uint8Array(digest));
  sessionStorage.setItem(PKCE_KEY, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: 'openid email',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(`${DOMAIN}/oauth2/authorize?${params}`);
}

async function tokenRequest(body: URLSearchParams): Promise<StoredTokens | null> {
  const res = await fetch(`${DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    id_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.id_token) return null;
  const tokens: StoredTokens = {
    idToken: json.id_token,
    refreshToken: json.refresh_token ?? loadTokens()?.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

// Conclui o redirect do Hosted UI (?code=...). Retorna true se trocou o code.
export async function completeLoginCallback(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;
  const verifier = sessionStorage.getItem(PKCE_KEY) ?? '';
  sessionStorage.removeItem(PKCE_KEY);

  await tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      code,
      code_verifier: verifier,
    }),
  );

  // Limpa o code da URL preservando hash e demais query params (ex.: setup do App).
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState(null, '', url.toString());
  return true;
}

// idToken válido (renova com o refresh token quando a 5 min de expirar).
// null = não autenticado (chamador decide redirecionar ao login).
export async function getIdToken(): Promise<string | null> {
  if (!authEnabled) return null;
  const tokens = loadTokens();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 5 * 60_000) return tokens.idToken;
  if (!tokens.refreshToken) return null;
  const refreshed = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: tokens.refreshToken,
    }),
  );
  return refreshed?.idToken ?? null;
}

// Remove os tokens da sessão do armazenamento local do client. Idempotente:
// pode ser chamado várias vezes com segurança (usado no fluxo de logout do menu
// para garantir estado local limpo mesmo quando a revogação server-side falha).
export function clearLocalSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

// Revoga o refresh token no Cognito (invalidação server-side da sessão). Lança
// em falha de rede ou resposta não-ok, para o chamador tratar e informar o
// usuário. No dev (auth desabilitada) ou sem refresh token é um no-op resolvido.
export async function revokeSession(): Promise<void> {
  if (!authEnabled) return;
  const tokens = loadTokens();
  if (!tokens?.refreshToken) return;
  const res = await fetch(`${DOMAIN}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, token: tokens.refreshToken }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao revogar a sessão no Cognito (HTTP ${res.status})`);
  }
}

// Redireciona o usuário para encerrar a sessão do Hosted UI e retornar ao login
// (o bootstrap detecta a ausência de token e dispara o login novamente). Em dev
// (auth desabilitada) apenas recarrega a aplicação a partir da raiz.
export function redirectToLogout(): void {
  if (!authEnabled) {
    window.location.assign('/');
    return;
  }
  const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: redirectUri() });
  window.location.assign(`${DOMAIN}/logout?${params}`);
}

// Logout "simples" (fire-and-forget) usado fora do menu de perfil: limpa o
// estado local e redireciona, sem aguardar a revogação server-side.
export function logout(): void {
  clearLocalSession();
  if (!authEnabled) return;
  redirectToLogout();
}
