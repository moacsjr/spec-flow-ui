// fetch autenticado da API: injeta o Authorization: Bearer <idToken> do Cognito
// em toda chamada /api. 401 (token ausente/expirado sem refresh) → limpa a
// sessão e recarrega — o bootstrap renderiza a tela de login própria. Em dev
// local sem Cognito (authEnabled=false), passa direto — o backend usa
// DEV_TENANT_ID.

import { authEnabled, clearTokens, getIdToken } from '../auth/cognito';

function backToLogin(): Promise<Response> {
  clearTokens();
  window.location.reload();
  return new Promise<Response>(() => {}); // a página vai recarregar
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (authEnabled) {
    const token = await getIdToken();
    if (!token) return backToLogin();
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && authEnabled) return backToLogin();
  return res;
}
