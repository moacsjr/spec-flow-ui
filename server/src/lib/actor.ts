// Autor real da sessão para artefatos do GitHub (spec Gestão de usuários §7):
// as escritas usam o token da instalação (GitHub App), então a autoria visível
// é a do bot — mitigamos registrando "por @{login}" no corpo e `author` nos
// marcadores estruturados. O login vem do vínculo do usuário (/api/me).

import { getUserPref } from '../db/dynamo.ts';
import { requestContext } from './requestContext.ts';

export async function actorLogin(tenantId: string): Promise<string | null> {
  const sub = requestContext.getStore()?.sub;
  if (!sub) return null;
  const pref = await getUserPref(tenantId, sub).catch(() => null);
  return pref?.githubLogin ?? null;
}
