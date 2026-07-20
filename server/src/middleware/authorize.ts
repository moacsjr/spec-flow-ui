// Autorização por papel de trabalho (spec "Gestão de usuários e perfis de
// acesso" §4): cada endpoint de escrita declara o papel exigido pela spec da
// sua tela; o middleware resolve sessão → membro → papéis no repositório.
// Nenhum contrato de endpoint muda — apenas a fonte do papel (da declaração
// para a sessão). O owner (root) NÃO bypassa papéis de trabalho — só os
// endpoints de administração (requireOwner). O 403 é rede de segurança; a UX
// primária são os modos somente-leitura das telas.

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { getMemberRoles, queryMemberRoles } from '../db/dynamo.ts';
import { tenantOf } from './auth.ts';

export type WorkRole = 'pm' | 'tech' | 'dev';

// Papéis do membro no repositório (cache por request seria overkill: 1 get).
async function rolesFor(tenantId: string, sub: string, repoId: string): Promise<string[]> {
  const rec = await getMemberRoles(tenantId, sub, repoId);
  return rec?.roles ?? [];
}

// Tabela método × sufixo de rota → papéis exigidos (o papel da spec de cada
// tela). Escritas fora da tabela caem na regra de leitura (qualquer papel) —
// a tabela cobre todas as rotas de escrita existentes.
const WRITE_RULES: { methods: string[]; re: RegExp; roles: WorkRole[] }[] = [
  // Developer
  { methods: ['POST'], re: /\/workitems\/[^/]+\/\d+\/start$/, roles: ['dev'] },
  { methods: ['PATCH'], re: /\/state$/, roles: ['dev'] },
  // Tech Leader
  { methods: ['PATCH'], re: /\/points$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/qa-(approve|return)$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/return-to-ready$/, roles: ['tech', 'dev'] },
  { methods: ['POST', 'PATCH', 'DELETE'], re: /\/review-drafts(\/|$)/, roles: ['tech'] },
  { methods: ['POST'], re: /\/return-to-pm$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/pre-review\/run$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/plan\/approve$/, roles: ['tech'] },
  { methods: ['POST', 'PATCH'], re: /\/decomposition(\/(generate|materialize))?$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/decompose$/, roles: ['tech'] },
  { methods: ['POST'], re: /\/progress-summary$/, roles: ['pm', 'tech'] },
  // Product Manager
  { methods: ['PATCH'], re: /\/priority$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/(prioritize|archive)$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/workitems\/bulk\/(prioritize|reparent|archive)$/, roles: ['pm'] },
  { methods: ['PATCH'], re: /\/rank$/, roles: ['pm'] },
  { methods: ['DELETE', 'PATCH'], re: /\/workitems\/[^/]+\/\d+$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/workitems$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/features$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/(reparent|reorder)$/, roles: ['pm'] },
  { methods: ['POST', 'PATCH', 'DELETE'], re: /\/milestones(\/\d+)?$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/release-notes$/, roles: ['pm'] },
  { methods: ['PUT', 'PATCH'], re: /\/milestone$/, roles: ['pm'] },
  { methods: ['PATCH'], re: /\/estimate$/, roles: ['pm'] },
  { methods: ['PATCH'], re: /\/review-comments\/\d+$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/review-comments\/reply$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/spec\/approve$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/return-to-prioritization$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/uat-(approve|return)$/, roles: ['pm'] },
  { methods: ['POST'], re: /\/start-development$/, roles: ['pm', 'tech'] },
  // Compartilhadas entre papéis (fallbacks manuais, artefatos, discussão)
  { methods: ['PATCH'], re: /\/stage$/, roles: ['pm', 'tech', 'dev'] },
  { methods: ['POST'], re: /\/(spec|plan)\/(create|refine|save)$/, roles: ['pm', 'tech'] },
  { methods: ['POST'], re: /\/discussion$/, roles: ['pm', 'tech', 'dev'] },
];

// Guard único por :id (router.param): leitura exige algum papel (ou owner);
// escrita exige o papel da regra correspondente (owner NÃO bypassa).
export function repoAccessParamGuard(
  req: Request,
  res: Response,
  next: NextFunction,
  repoId: string,
): void {
  if (!config.authEnforced) {
    next();
    return;
  }
  const tenant = tenantOf(req);
  const rule =
    req.method === 'GET'
      ? undefined
      : WRITE_RULES.find((r) => r.methods.includes(req.method) && r.re.test(req.path));

  rolesFor(tenant.tenantId, tenant.sub, repoId)
    .then((roles) => {
      if (rule) {
        if (rule.roles.some((r) => roles.includes(r))) {
          next();
          return;
        }
        res.status(403).json({
          error: `Ação restrita ao papel ${rule.roles.join(' ou ')} neste repositório.`,
          requiredRole: rule.roles[0],
        });
        return;
      }
      // Leitura (e escritas administrativas, que têm requireOwner próprio).
      if (tenant.role === 'owner' || roles.length > 0) {
        next();
        return;
      }
      res.status(403).json({ error: 'Você não tem acesso a este repositório.' });
    })
    .catch(next);
}

// Repositórios visíveis para um membro (filtro do seletor). Owner vê todos.
export async function visibleRepoIds(
  tenantId: string,
  sub: string,
  role: 'owner' | 'member',
): Promise<Set<string> | null> {
  if (!config.authEnforced || role === 'owner') return null; // null = todos
  const assignments = await queryMemberRoles(tenantId, sub);
  return new Set(assignments.filter((a) => a.roles.length > 0).map((a) => a.repoId));
}
