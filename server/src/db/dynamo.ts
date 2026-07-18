// Persistência multi-tenant em DynamoDB (single-table). Todo acesso a dados
// passa por aqui e SEMPRE exige a PK do dono (TENANT#<id> etc.) — isolamento por
// construção: não existe query sem tenant.
//
// Layout (PK / SK):
//   TENANT#<id>            / META                → tenant (name, plan, status)
//   USER#<cognitoSub>      / META                → vínculo user→tenant
//   TENANT#<id>            / REPO#<ulid>         → repositório conectado
//   TENANT#<id>            / REPOURL#<url>       → lock de unicidade da url no tenant
//   TENANT#<id>            / INSTALLATION#<id>   → instalação do App listável pelo tenant
//   INSTALLATION#<id>      / META                → instalação canônica (webhook resolve tenant)
//   STATE#<nonce>          / META                → state do onboarding (TTL 15 min)
//   TENANT#<id>            / USAGE#<yyyy-mm>     → contador mensal de refines (cota)
//   TENANT#<id>            / MEMBER#<sub>        → membros listáveis pelo tenant
//   TENANT#<id>            / INVITE#<code>       → convite listável pelo tenant
//   INVITECODE#<code>      / META                → convite canônico (aceite resolve tenant; TTL 7 dias)
//   STRIPECUST#<custId>    / META                → mapeamento customer Stripe → tenant

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from '../config.ts';
import { HttpError } from '../lib/errors.ts';
import { requestContext } from '../lib/requestContext.ts';

const client = new DynamoDBClient(
  config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint } : {},
);
const defaultDoc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// Client efetivo: o tenant-scoped do request (LeadingKeys, fase 2) quando
// presente; senão o default (webhook, triggers, dev local).
function doc(): DynamoDBDocumentClient {
  return requestContext.getStore()?.doc ?? defaultDoc;
}

const TABLE = config.tableName;

// ---------- Tenants e usuários ----------

export interface TenantRecord {
  tenantId: string;
  name: string;
  plan: string; // 'free' | 'pro' — atualizado pelo webhook do Stripe
  status: 'active' | 'suspended';
  createdAt: string;
  stripeCustomerId?: string;
  subscriptionStatus?: string; // status cru da subscription no Stripe
  openrouterKeyCiphertext?: string; // chave OpenRouter do tenant, cifrada (KMS)
}

export interface UserRecord {
  sub: string;
  tenantId: string;
  email: string;
  role: 'owner' | 'member';
  createdAt: string;
}

export async function putTenant(t: TenantRecord): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `TENANT#${t.tenantId}`, SK: 'META', ...t },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

export async function putUser(u: UserRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { PK: `USER#${u.sub}`, SK: 'META', ...u } }),
  );
}

export async function getTenant(tenantId: string): Promise<TenantRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { PK: `TENANT#${tenantId}`, SK: 'META' } }),
  );
  return (out.Item as TenantRecord | undefined) ?? null;
}

// Atualiza campos pontuais do tenant (plan/billing/chave própria). Item ausente
// → falha da condição (nunca cria tenant implicitamente).
export async function updateTenantFields(
  tenantId: string,
  fields: Partial<Pick<TenantRecord, 'plan' | 'stripeCustomerId' | 'subscriptionStatus' | 'openrouterKeyCiphertext'>>,
): Promise<void> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  const removes: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    names[`#${k}`] = k;
    if (v === undefined || v === '') {
      removes.push(`#${k}`);
    } else {
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
  }
  if (!sets.length && !removes.length) return;
  const expr = [
    sets.length ? `SET ${sets.join(', ')}` : '',
    removes.length ? `REMOVE ${removes.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  await doc().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `TENANT#${tenantId}`, SK: 'META' },
      UpdateExpression: expr,
      ExpressionAttributeNames: names,
      ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );
}

export async function getUser(sub: string): Promise<UserRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { PK: `USER#${sub}`, SK: 'META' } }),
  );
  return (out.Item as UserRecord | undefined) ?? null;
}

// ---------- Repositórios ----------

export interface RepositoryRecord {
  id: string; // ULID
  tenantId: string;
  name: string;
  url: string;
  installationId: number;
  createdAt: string; // ISO 8601
  projectUrl?: string | null;
  projectId?: string | null;
  projectNumber?: number | null;
  etapaFieldId?: string | null;
  stageOptions?: Record<string, string> | null;
}

const repoKey = (tenantId: string, repoId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `REPO#${repoId}`,
});
const urlKey = (tenantId: string, url: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `REPOURL#${url}`,
});

// Cria o repositório em transação com o lock de unicidade da url. Url já usada
// no tenant → 409.
export async function createRepositoryRecord(record: RepositoryRecord): Promise<void> {
  try {
    await doc().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: { ...repoKey(record.tenantId, record.id), ...record },
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
          {
            Put: {
              TableName: TABLE,
              Item: { ...urlKey(record.tenantId, record.url), repoId: record.id },
              ConditionExpression: 'attribute_not_exists(SK)',
            },
          },
        ],
      }),
    );
  } catch (err) {
    if ((err as Error).name === 'TransactionCanceledException') {
      throw new HttpError(409, `Repositório já cadastrado: ${record.url}.`);
    }
    throw err;
  }
}

// Substitui o registro inteiro (edição). Quando a url muda, troca o lock na
// mesma transação (nova url já usada → 409).
export async function replaceRepositoryRecord(
  record: RepositoryRecord,
  previousUrl: string,
): Promise<void> {
  const items: NonNullable<
    ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
  > = [
    { Put: { TableName: TABLE, Item: { ...repoKey(record.tenantId, record.id), ...record } } },
  ];
  if (record.url !== previousUrl) {
    items.push(
      { Delete: { TableName: TABLE, Key: urlKey(record.tenantId, previousUrl) } },
      {
        Put: {
          TableName: TABLE,
          Item: { ...urlKey(record.tenantId, record.url), repoId: record.id },
          ConditionExpression: 'attribute_not_exists(SK)',
        },
      },
    );
  }
  try {
    await doc().send(new TransactWriteCommand({ TransactItems: items }));
  } catch (err) {
    if ((err as Error).name === 'TransactionCanceledException') {
      throw new HttpError(409, `Repositório já cadastrado: ${record.url}.`);
    }
    throw err;
  }
}

export async function getRepositoryRecord(
  tenantId: string,
  repoId: string,
): Promise<RepositoryRecord | null> {
  const out = await doc().send(new GetCommand({ TableName: TABLE, Key: repoKey(tenantId, repoId) }));
  return (out.Item as RepositoryRecord | undefined) ?? null;
}

// Lista os repositórios do tenant (mais recentes primeiro, até `limit`).
export async function queryRepositoryRecords(
  tenantId: string,
  limit = config.pageLimit,
): Promise<RepositoryRecord[]> {
  const out = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'REPO#' },
    }),
  );
  const rows = (out.Items ?? []) as RepositoryRecord[];
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.slice(0, limit);
}

// ---------- Instalações do GitHub App ----------

export interface InstallationRecord {
  installationId: number;
  tenantId: string | null; // null = órfã (webhook chegou antes do setup)
  accountLogin: string;
  status: 'active' | 'deleted';
  createdAt: string;
}

export async function putInstallation(rec: InstallationRecord): Promise<void> {
  const writes: Promise<unknown>[] = [
    doc().send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `INSTALLATION#${rec.installationId}`, SK: 'META', ...rec },
      }),
    ),
  ];
  // Item espelho sob o tenant, para listar instalações sem GSI.
  if (rec.tenantId) {
    writes.push(
      doc().send(
        new PutCommand({
          TableName: TABLE,
          Item: {
            PK: `TENANT#${rec.tenantId}`,
            SK: `INSTALLATION#${rec.installationId}`,
            ...rec,
          },
        }),
      ),
    );
  }
  await Promise.all(writes);
}

export async function getInstallation(installationId: number): Promise<InstallationRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { PK: `INSTALLATION#${installationId}`, SK: 'META' } }),
  );
  return (out.Item as InstallationRecord | undefined) ?? null;
}

export async function markInstallationDeleted(installationId: number): Promise<void> {
  const existing = await getInstallation(installationId);
  if (!existing) return;
  await putInstallation({ ...existing, status: 'deleted' });
}

// ---------- Ordem de exibição custom (tela Project) ----------
// Lista global de números de issue por tenant/repo — a árvore ordena por ela.
// App-privado (não vai para o GitHub). Auto-reconciliável: números ausentes são
// ignorados na leitura; itens novos entram por número no client.
// SK NÃO pode começar com "REPO#" — a listagem de repositórios usa
// begins_with(SK, 'REPO#') e capturaria este item como um repo fantasma.
const orderKey = (tenantId: string, repoId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `ORDER#${repoId}`,
});

export async function getDisplayOrder(tenantId: string, repoId: string): Promise<number[]> {
  const out = await doc().send(new GetCommand({ TableName: TABLE, Key: orderKey(tenantId, repoId) }));
  const order = (out.Item as { order?: unknown } | undefined)?.order;
  return Array.isArray(order) ? (order.filter((n) => typeof n === 'number') as number[]) : [];
}

export async function setDisplayOrder(
  tenantId: string,
  repoId: string,
  order: number[],
): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { ...orderKey(tenantId, repoId), order },
    }),
  );
}

// ---------- State do onboarding (instalação do App) ----------

export interface OnboardingState {
  nonce: string;
  tenantId: string;
  userSub: string;
  ttl: number; // epoch seconds — TTL nativo do DynamoDB
}

export async function putState(state: OnboardingState): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { PK: `STATE#${state.nonce}`, SK: 'META', ...state } }),
  );
}

// Consome (lê e apaga) o state — uso único. Expirado/ausente → null.
export async function consumeState(nonce: string): Promise<OnboardingState | null> {
  const out = await doc().send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `STATE#${nonce}`, SK: 'META' },
      ReturnValues: 'ALL_OLD',
    }),
  );
  const state = out.Attributes as OnboardingState | undefined;
  if (!state) return null;
  if (state.ttl * 1000 < Date.now()) return null; // TTL do Dynamo é eventual — reforça aqui
  return state;
}

// ---------- Cota mensal de refines (fase 3) ----------

// Incrementa o contador do mês ATOMICAMENTE, falhando se o limite do plano já
// foi atingido (token bucket mensal). Limite estourado → false.
export async function consumeMonthlyRefine(
  tenantId: string,
  month: string,
  limit: number,
): Promise<boolean> {
  try {
    await doc().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `TENANT#${tenantId}`, SK: `USAGE#${month}` },
        UpdateExpression: 'ADD refines :one',
        ConditionExpression: 'attribute_not_exists(refines) OR refines < :limit',
        ExpressionAttributeValues: { ':one': 1, ':limit': limit },
      }),
    );
    return true;
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function getMonthlyUsage(tenantId: string, month: string): Promise<number> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { PK: `TENANT#${tenantId}`, SK: `USAGE#${month}` } }),
  );
  return (out.Item as { refines?: number } | undefined)?.refines ?? 0;
}

// ---------- Job de refino assíncrono (202 + polling) ----------

export interface RefineJobRecord {
  tenantId: string;
  jobId: string;
  status: 'pending' | 'done' | 'error';
  kind: string; // 'spec' | 'plan'
  content?: string;
  error?: string;
  createdAt: string; // ISO
  ttl: number; // epoch seconds — TTL nativo do DynamoDB (~1h)
}

const refineJobKey = (tenantId: string, jobId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `REFINEJOB#${jobId}`,
});

export async function putRefineJob(rec: RefineJobRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...refineJobKey(rec.tenantId, rec.jobId), ...rec } }),
  );
}

// Move o job para done/error, gravando content ou error. `status`/`error` são
// palavras reservadas do DynamoDB → alias com ExpressionAttributeNames.
export async function updateRefineJob(
  tenantId: string,
  jobId: string,
  patch: { status: 'done' | 'error'; content?: string; error?: string },
): Promise<void> {
  const sets = ['#s = :s'];
  const names: Record<string, string> = { '#s': 'status' };
  const values: Record<string, unknown> = { ':s': patch.status };
  if (patch.content !== undefined) {
    sets.push('content = :c');
    values[':c'] = patch.content;
  }
  if (patch.error !== undefined) {
    sets.push('#e = :e');
    names['#e'] = 'error';
    values[':e'] = patch.error;
  }
  await doc().send(
    new UpdateCommand({
      TableName: TABLE,
      Key: refineJobKey(tenantId, jobId),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );
}

// ---------- Triagem de comentários de revisão de spec (tela Specification) ----------
// Estado da triagem (aceito/descartado/aplicado) por comentário do GitHub. A
// issue NÃO é alterada pela triagem — só por réplicas explícitas.

export type SpecTriageState = 'pending' | 'accepted' | 'dismissed' | 'applied';

export interface SpecTriageRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  commentId: number;
  state: SpecTriageState;
  instruction?: string; // instrução editada pelo PM (default: corpo do comentário)
  updatedAt: string; // ISO
}

const specTriageKey = (t: SpecTriageRecord | { tenantId: string; repoId: string; issueNumber: number; commentId: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `SPECTRIAGE#${t.repoId}#${t.issueNumber}#${t.commentId}`,
});

export async function putSpecTriage(rec: SpecTriageRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...specTriageKey(rec), ...rec } }),
  );
}

export async function querySpecTriage(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<SpecTriageRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `SPECTRIAGE#${repoId}#${issueNumber}#`,
      },
    }),
  );
  return (res.Items ?? []) as SpecTriageRecord[];
}

// TTL do Dynamo é eventual — reforça a expiração na leitura (como consumeState).
export async function getRefineJob(tenantId: string, jobId: string): Promise<RefineJobRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: refineJobKey(tenantId, jobId) }),
  );
  const job = out.Item as RefineJobRecord | undefined;
  if (!job) return null;
  if (job.ttl * 1000 < Date.now()) return null;
  return job;
}

// ---------- Membros do tenant (fase 3) ----------

export interface MemberRecord {
  sub: string;
  tenantId: string;
  email: string;
  role: 'owner' | 'member';
  createdAt: string;
}

export async function putMember(m: MemberRecord): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `TENANT#${m.tenantId}`, SK: `MEMBER#${m.sub}`, ...m },
    }),
  );
}

export async function deleteMember(tenantId: string, sub: string): Promise<void> {
  await doc().send(
    new DeleteCommand({ TableName: TABLE, Key: { PK: `TENANT#${tenantId}`, SK: `MEMBER#${sub}` } }),
  );
}

export async function listMembers(tenantId: string): Promise<MemberRecord[]> {
  const out = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'MEMBER#' },
    }),
  );
  return (out.Items ?? []) as MemberRecord[];
}

// ---------- Convites (fase 3) ----------

export interface InviteRecord {
  code: string;
  tenantId: string;
  email: string;
  role: 'member' | 'owner';
  invitedBy: string; // sub de quem convidou
  createdAt: string;
  ttl: number; // epoch seconds (7 dias)
}

export async function putInvite(invite: InviteRecord): Promise<void> {
  // Canônico (aceite resolve por código) + espelho listável pelo tenant.
  await Promise.all([
    doc().send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `INVITECODE#${invite.code}`, SK: 'META', ...invite },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    ),
    doc().send(
      new PutCommand({
        TableName: TABLE,
        Item: { PK: `TENANT#${invite.tenantId}`, SK: `INVITE#${invite.code}`, ...invite },
      }),
    ),
  ]);
}

// Consome (lê e apaga) um convite — uso único. Expirado/ausente → null.
export async function consumeInvite(code: string): Promise<InviteRecord | null> {
  const out = await doc().send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: `INVITECODE#${code}`, SK: 'META' },
      ReturnValues: 'ALL_OLD',
    }),
  );
  const invite = out.Attributes as InviteRecord | undefined;
  if (!invite) return null;
  if (invite.ttl * 1000 < Date.now()) return null;
  await doc()
    .send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `TENANT#${invite.tenantId}`, SK: `INVITE#${code}` },
      }),
    )
    .catch(() => {}); // espelho é best-effort
  return invite;
}

export async function listInvites(tenantId: string): Promise<InviteRecord[]> {
  const out = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'INVITE#' },
    }),
  );
  const now = Date.now();
  return ((out.Items ?? []) as InviteRecord[]).filter((i) => i.ttl * 1000 > now);
}

// ---------- Mapeamento Stripe customer → tenant (fase 3) ----------

export async function putStripeCustomer(customerId: string, tenantId: string): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `STRIPECUST#${customerId}`, SK: 'META', customerId, tenantId },
    }),
  );
}

export async function getStripeCustomerTenant(customerId: string): Promise<string | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: { PK: `STRIPECUST#${customerId}`, SK: 'META' } }),
  );
  return (out.Item as { tenantId?: string } | undefined)?.tenantId ?? null;
}
