// Contexto por request (AsyncLocalStorage): carrega o tenant e, quando o
// hardening de LeadingKeys está ativo (TENANT_ROLE_ARN), o DocumentClient com
// credenciais STS restritas às chaves TENANT#<tenant> — mesmo um bug de código
// que esquecesse o tenantId na query seria barrado pelo IAM.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface RequestStore {
  tenantId: string;
  requestId: string;
  sub?: string; // usuário da sessão (autoria de transições/comentários)
  doc?: DynamoDBDocumentClient; // client tenant-scoped (ausente = client default)
}

export const requestContext = new AsyncLocalStorage<RequestStore>();
