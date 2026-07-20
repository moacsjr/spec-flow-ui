// Autenticação Cognito com TELA DE LOGIN PRÓPRIA (design "SpecWave Login"):
// e-mail/senha direto na API do user pool (InitiateAuth USER_PASSWORD_AUTH —
// exige ALLOW_USER_PASSWORD_AUTH no app client), mais os fluxos auxiliares que
// o Hosted UI cobria: nova senha obrigatória, esqueci a senha, cadastro com
// confirmação por código. O Hosted UI permanece SÓ para federação (Google).
// Tudo sem dependência externa (fetch + Web Crypto); a validação do JWT segue
// no JWT authorizer do API Gateway.
//
// Config via env do Vite (definida no build pela infra):
//   VITE_COGNITO_DOMAIN    ex.: https://spec-wave.auth.us-east-1.amazoncognito.com
//   VITE_COGNITO_CLIENT_ID app client (sem secret)
//   VITE_COGNITO_REGION    opcional — derivada do domain quando *.auth.<r>.amazoncognito.com
//   VITE_COGNITO_GOOGLE    "1" exibe "Continuar com Google" (exige IdP Google no pool)
// Sem domain/client (dev local), a auth fica DESABILITADA e o backend usa
// DEV_TENANT_ID — nada de token no request.

const DOMAIN = (import.meta.env.VITE_COGNITO_DOMAIN as string | undefined) ?? '';
const CLIENT_ID = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? '';
const REGION =
  ((import.meta.env.VITE_COGNITO_REGION as string | undefined) ?? '') ||
  (DOMAIN.match(/\.auth\.([a-z0-9-]+)\.amazoncognito\.com/)?.[1] ?? '');

const STORAGE_KEY = 'spec-wave.auth';
const PKCE_KEY = 'spec-wave.pkce';

interface StoredTokens {
  idToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
}

export const authEnabled = Boolean(DOMAIN && CLIENT_ID);
export const googleEnabled =
  authEnabled && (import.meta.env.VITE_COGNITO_GOOGLE as string | undefined) === '1';

const redirectUri = () => `${window.location.origin}/`;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---- storage ("Manter conectado" → localStorage; senão sessionStorage) ----

function loadTokens(): { tokens: StoredTokens; store: Storage } | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) return { tokens: JSON.parse(raw) as StoredTokens, store };
    } catch {
      /* storage indisponível */
    }
  }
  return null;
}

function saveTokens(t: StoredTokens, store: Storage): void {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* modo privado */
  }
}

export function clearTokens(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
}

// ---- API direta do user pool (cognito-idp) ----

const IDP_ENDPOINT = REGION ? `https://cognito-idp.${REGION}.amazonaws.com/` : '';

// Erro da API do Cognito com o código legível (ex.: NotAuthorizedException).
export class CognitoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function idpCall<T>(target: string, payload: Record<string, unknown>): Promise<T> {
  if (!IDP_ENDPOINT) {
    throw new CognitoError('NotConfigured', 'Região do Cognito não configurada (VITE_COGNITO_REGION).');
  }
  const res = await fetch(IDP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(json.__type ?? 'UnknownError').split('#').pop() as string;
    throw new CognitoError(type, String(json.message ?? type));
  }
  return json as T;
}

interface AuthResult {
  AuthenticationResult?: {
    IdToken?: string;
    RefreshToken?: string;
    ExpiresIn?: number;
  };
  ChallengeName?: string;
  Session?: string;
}

function storeAuthResult(r: AuthResult, remember: boolean, prevRefresh?: string): boolean {
  const a = r.AuthenticationResult;
  if (!a?.IdToken) return false;
  clearTokens();
  saveTokens(
    {
      idToken: a.IdToken,
      refreshToken: a.RefreshToken ?? prevRefresh,
      expiresAt: Date.now() + (a.ExpiresIn ?? 3600) * 1000,
    },
    remember ? localStorage : sessionStorage,
  );
  return true;
}

// Sign-in por e-mail/senha. Retorna:
//   { ok: true }                        → autenticado (tokens gravados)
//   { challenge: 'NEW_PASSWORD_REQUIRED', session } → primeira senha (convite admin)
// Erros sobem como CognitoError (NotAuthorizedException, UserNotConfirmedException…).
export async function signInWithPassword(
  email: string,
  password: string,
  remember: boolean,
): Promise<{ ok: true } | { challenge: 'NEW_PASSWORD_REQUIRED'; session: string }> {
  const r = await idpCall<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  if (r.ChallengeName === 'NEW_PASSWORD_REQUIRED' && r.Session) {
    return { challenge: 'NEW_PASSWORD_REQUIRED', session: r.Session };
  }
  if (storeAuthResult(r, remember)) return { ok: true };
  throw new CognitoError(r.ChallengeName ?? 'UnsupportedChallenge', `Desafio não suportado: ${r.ChallengeName}.`);
}

// Conclui o challenge NEW_PASSWORD_REQUIRED (primeiro acesso de convidado).
export async function completeNewPassword(
  email: string,
  newPassword: string,
  session: string,
  remember: boolean,
): Promise<void> {
  const r = await idpCall<AuthResult>('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: CLIENT_ID,
    Session: session,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  });
  if (!storeAuthResult(r, remember)) {
    throw new CognitoError('UnsupportedChallenge', 'Não foi possível concluir a troca de senha.');
  }
}

// Esqueci a senha: envia o código e confirma a nova senha.
export async function forgotPassword(email: string): Promise<void> {
  await idpCall('ForgotPassword', { ClientId: CLIENT_ID, Username: email });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await idpCall('ConfirmForgotPassword', {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  });
}

// Cadastro (signup aberto do produto) com confirmação por código no e-mail.
export async function signUp(email: string, password: string): Promise<void> {
  await idpCall('SignUp', {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await idpCall('ConfirmSignUp', { ClientId: CLIENT_ID, Username: email, ConfirmationCode: code });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await idpCall('ResendConfirmationCode', { ClientId: CLIENT_ID, Username: email });
}

// ---- Hosted UI (mantido para federação — Google) ----

// Redireciona para o Hosted UI (code + PKCE); identity_provider pula a página
// do Cognito e vai direto ao IdP (ex.: 'Google').
export async function login(identityProvider?: string): Promise<void> {
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
    ...(identityProvider ? { identity_provider: identityProvider } : {}),
  });
  window.location.assign(`${DOMAIN}/oauth2/authorize?${params}`);
}

export const loginWithGoogle = (): Promise<void> => login('Google');

async function hostedTokenRequest(body: URLSearchParams, store: Storage): Promise<StoredTokens | null> {
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
    refreshToken: json.refresh_token ?? loadTokens()?.tokens.refreshToken,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  saveTokens(tokens, store);
  return tokens;
}

// Conclui o redirect do Hosted UI (?code=...). Retorna true se trocou o code.
export async function completeLoginCallback(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;
  const verifier = sessionStorage.getItem(PKCE_KEY) ?? '';
  sessionStorage.removeItem(PKCE_KEY);

  await hostedTokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      code,
      code_verifier: verifier,
    }),
    sessionStorage,
  );

  // Limpa o code da URL preservando hash e demais query params (ex.: setup do App).
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState(null, '', url.toString());
  return true;
}

// ---- sessão ----

// idToken válido (renova quando a 5 min de expirar — via cognito-idp, que não
// depende do domain do Hosted UI). null = não autenticado.
export async function getIdToken(): Promise<string | null> {
  if (!authEnabled) return null;
  const found = loadTokens();
  if (!found) return null;
  const { tokens, store } = found;
  if (tokens.expiresAt - Date.now() > 5 * 60_000) return tokens.idToken;
  if (!tokens.refreshToken) return null;
  try {
    const r = await idpCall<AuthResult>('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: tokens.refreshToken },
    });
    const a = r.AuthenticationResult;
    if (!a?.IdToken) return null;
    const next: StoredTokens = {
      idToken: a.IdToken,
      refreshToken: a.RefreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + (a.ExpiresIn ?? 3600) * 1000,
    };
    saveTokens(next, store);
    return next.idToken;
  } catch {
    return null;
  }
}

export function logout(): void {
  clearTokens();
  if (!authEnabled) return;
  const params = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: redirectUri() });
  window.location.assign(`${DOMAIN}/logout?${params}`);
}
