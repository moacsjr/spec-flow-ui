// Bootstrap de autenticação/onboarding executado ANTES do render do App:
//   1. Conclui o callback do Hosted UI (?code=... — federação Google)
//   2. Garante sessão (sem token → o caller renderiza a TELA DE LOGIN própria)
//   3. Conclui o setup do GitHub App (?installation_id=...&state=... — o GitHub
//      redireciona para cá após a instalação) chamando POST /api/github/setup
//
// 'app' = renderiza o App; 'login' = renderiza a LoginPage (design SpecWave).

import { authEnabled, completeLoginCallback, getIdToken } from './cognito';
import { apiFetch } from '../data/apiFetch';

export async function bootstrapAuth(): Promise<'app' | 'login'> {
  if (!authEnabled) {
    await finishGitHubSetup(); // dev local: setup ainda funciona via DEV_TENANT_ID
    return 'app';
  }

  await completeLoginCallback();

  const token = await getIdToken();
  if (!token) return 'login';

  await finishGitHubSetup();
  return 'app';
}

async function finishGitHubSetup(): Promise<void> {
  const url = new URL(window.location.href);
  const installationId = url.searchParams.get('installation_id');
  const state = url.searchParams.get('state');
  if (!installationId || !state) return;

  try {
    const res = await apiFetch('/api/github/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: Number(installationId), state }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      alert(body.error ?? 'Falha ao concluir a instalação do GitHub App.');
    }
  } finally {
    // Limpa os params do setup da URL (sucesso ou falha — o retry é reinstalar).
    url.searchParams.delete('installation_id');
    url.searchParams.delete('setup_action');
    url.searchParams.delete('state');
    window.history.replaceState(null, '', url.toString());
  }
}
