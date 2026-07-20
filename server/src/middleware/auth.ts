// Contexto de tenant por request. A assinatura do JWT já foi validada pelo JWT
// authorizer do API Gateway (Cognito) — aqui só extraímos os claims que o
// serverless-http repassa no evento original (req.apiGatewayEvent, ver lambda.ts)
// e populamos req.tenant. Sem claim de tenant → 401.
//
// Fase 2 (defesa em profundidade): com TENANT_ROLE_ARN configurado, o restante
// da cadeia roda dentro de um AsyncLocalStorage com um DocumentClient cujas
// credenciais STS só alcançam as chaves TENANT#<tenant> no DynamoDB
// (dynamodb:LeadingKeys). O db/dynamo.ts usa esse client automaticamente.
//
// Dev local (sem Cognito/API GW): DEV_TENANT_ID no env assume o papel do claim.
// A flag é ignorada em produção (ver config.ts).

import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { logger } from '../lib/logger.ts';
import { requestContext } from '../lib/requestContext.ts';
import { tenantScopedDocClient } from '../lib/tenantCredentials.ts';

export interface TenantContext {
  tenantId: string;
  sub: string;
  email?: string;
  role: 'owner' | 'member';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      apiGatewayEvent?: {
        requestContext?: {
          requestId?: string;
          authorizer?: { jwt?: { claims?: Record<string, string> } };
        };
      };
    }
  }
}

export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const claims = req.apiGatewayEvent?.requestContext?.authorizer?.jwt?.claims;
  const tenantId = claims?.['custom:tenant_id'] ?? (config.devTenantId || undefined);
  const sub = claims?.sub ?? (config.devTenantId ? 'dev-user' : undefined);

  if (!tenantId || !sub) {
    res.status(401).json({ error: 'Não autenticado (tenant ausente no token).' });
    return;
  }
  // Role vem do claim custom:role (PreTokenGeneration); dev local = owner.
  const role = claims?.['custom:role'] === 'member' ? 'member' : 'owner';
  req.tenant = { tenantId, sub, email: claims?.email, role };

  const requestId = req.apiGatewayEvent?.requestContext?.requestId ?? randomUUID();

  // Log de acesso estruturado (auditoria por tenant via Logs Insights).
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info(
      JSON.stringify({
        type: 'access',
        requestId,
        tenantId,
        sub,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }),
    );
  });

  // Hardening LeadingKeys: falha ao assumir a role NÃO degrada para o client
  // default (seria bypass silencioso do isolamento IAM) — vira 500.
  tenantScopedDocClient(tenantId)
    .then((doc) => {
      requestContext.run({ tenantId, requestId, sub, doc }, () => next());
    })
    .catch((err) => {
      logger.error(`Falha ao obter credenciais do tenant ${tenantId}: ${(err as Error).message}`);
      res.status(500).json({ error: 'Internal server error' });
    });
}

// Helper para controllers: tenant garantido pelo middleware acima.
export function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw new Error('tenantContext middleware não aplicado na rota.');
  return req.tenant;
}

// Rotas restritas ao owner (billing, convites, gestão de repositórios/segredos).
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (tenantOf(req).role !== 'owner') {
    res.status(403).json({ error: 'Ação restrita ao owner da conta.' });
    return;
  }
  next();
}
