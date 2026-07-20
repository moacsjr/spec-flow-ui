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
  wipThreshold?: number | null; // WIP pessoal persuasivo do workspace Dev (default 2)
  // Discussão integrada (Slack): bot token cifrado com KMS (contexto tenantId),
  // como a chave OpenRouter do tenant. Prefixo "plain:" só em dev local sem KMS.
  slackTokenCiphertext?: string | null;
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

// ---------- Proposta de decomposição (Plan view do TL) ----------
// Fase 1: job LLM produz a proposta editável; fase 2: materialização sequencial
// idempotente via API (progresso persistido por item — issueNumber preenchido).

export interface ProposalTask {
  tempId: string;
  title: string;
  issueNumber?: number;
}

export interface ProposalStory {
  tempId: string;
  title: string;
  userStory: string;
  points: number;
  origin: 'ai' | 'manual';
  issueNumber?: number;
  nodeId?: string; // node do GitHub (link das Tasks como sub-issues)
  tasks: ProposalTask[];
}

export type ProposalStatus =
  | 'pending'
  | 'draft'
  | 'invalidated'
  | 'materializing'
  | 'done'
  | 'error';

export interface DecompositionProposalRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  planSha: string | null;
  status: ProposalStatus;
  stories: ProposalStory[];
  error?: string;
  updatedAt: string; // ISO
}

const proposalKey = (t: { tenantId: string; repoId: string; issueNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `DECOMP#${t.repoId}#${t.issueNumber}`,
});

export async function putProposal(rec: DecompositionProposalRecord): Promise<void> {
  await doc().send(new PutCommand({ TableName: TABLE, Item: { ...proposalKey(rec), ...rec } }));
}

export async function getProposal(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<DecompositionProposalRecord | null> {
  const res = await doc().send(
    new GetCommand({ TableName: TABLE, Key: proposalKey({ tenantId, repoId, issueNumber }) }),
  );
  return (res.Item as DecompositionProposalRecord | undefined) ?? null;
}

// ---------- Revisão técnica do TL (rascunhos, ciclos e pré-review) ----------
// Rascunhos de comentários (staged): NADA é postado na issue até a devolução.

export interface ReviewDraftRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  draftId: string;
  body: string;
  anchor: unknown | null; // formato da âncora da Specification (§4.2)
  specSha: string | null;
  createdAt: string; // ISO
}

const reviewDraftKey = (t: { tenantId: string; repoId: string; issueNumber: number; draftId: string }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `REVDRAFT#${t.repoId}#${t.issueNumber}#${t.draftId}`,
});

export async function putReviewDraft(rec: ReviewDraftRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...reviewDraftKey(rec), ...rec } }),
  );
}

export async function deleteReviewDraft(
  tenantId: string,
  repoId: string,
  issueNumber: number,
  draftId: string,
): Promise<void> {
  await doc().send(
    new DeleteCommand({
      TableName: TABLE,
      Key: reviewDraftKey({ tenantId, repoId, issueNumber, draftId }),
    }),
  );
}

export async function queryReviewDrafts(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<ReviewDraftRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `REVDRAFT#${repoId}#${issueNumber}#`,
      },
    }),
  );
  return (res.Items ?? []) as ReviewDraftRecord[];
}

// Ciclo de revisão: registrado na devolução ao PM (specSha revisado + comentários).
export interface ReviewCycleRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  specSha: string | null;
  returnedAt: string; // ISO
  commentIds: number[]; // comentários publicados na issue neste ciclo
}

// Um ciclo por item (o último vence — a re-revisão olha o ciclo mais recente).
const reviewCycleKey = (t: { tenantId: string; repoId: string; issueNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `REVCYCLE#${t.repoId}#${t.issueNumber}`,
});

export async function putReviewCycle(rec: ReviewCycleRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...reviewCycleKey(rec), ...rec } }),
  );
}

export async function getReviewCycle(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<ReviewCycleRecord | null> {
  const res = await doc().send(
    new GetCommand({ TableName: TABLE, Key: reviewCycleKey({ tenantId, repoId, issueNumber }) }),
  );
  return (res.Item as ReviewCycleRecord | undefined) ?? null;
}

// Pré-review por IA: achados por item (uma execução automática; manual substitui).
export interface PreReviewFinding {
  text: string;
  anchor: unknown | null;
  severity: 'info' | 'warning';
}

export interface PreReviewRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  status: 'pending' | 'done' | 'error';
  specSha: string | null;
  findings: PreReviewFinding[];
  error?: string;
  updatedAt: string; // ISO
}

const preReviewKey = (t: { tenantId: string; repoId: string; issueNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `PREREVIEW#${t.repoId}#${t.issueNumber}`,
});

export async function putPreReview(rec: PreReviewRecord): Promise<void> {
  await doc().send(new PutCommand({ TableName: TABLE, Item: { ...preReviewKey(rec), ...rec } }));
}

export async function getPreReview(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<PreReviewRecord | null> {
  const res = await doc().send(
    new GetCommand({ TableName: TABLE, Key: preReviewKey({ tenantId, repoId, issueNumber }) }),
  );
  return (res.Item as PreReviewRecord | undefined) ?? null;
}

// ---------- Metadados da estimativa por IA (tela Planning) ----------
// O VALOR fica no campo numérico "Estimate" do Projects v2 (sem lock-in); aqui
// vive só a origem (ai|manual), a versão da spec usada e o marcador de spec
// desatualizada (origem manual não é reestimada — só sinalizada).

export type EstimateOrigin = 'ai' | 'manual';

export interface EstimateMetaRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  origin: EstimateOrigin;
  specSha: string | null; // commit da spec usado na estimativa
  stale: boolean; // spec mudou depois de uma estimativa manual
  updatedAt: string; // ISO
}

const estimateMetaKey = (t: { tenantId: string; repoId: string; issueNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `ESTMETA#${t.repoId}#${t.issueNumber}`,
});

export async function putEstimateMeta(rec: EstimateMetaRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...estimateMetaKey(rec), ...rec } }),
  );
}

export async function getEstimateMeta(
  tenantId: string,
  repoId: string,
  issueNumber: number,
): Promise<EstimateMetaRecord | null> {
  const res = await doc().send(
    new GetCommand({ TableName: TABLE, Key: estimateMetaKey({ tenantId, repoId, issueNumber }) }),
  );
  return (res.Item as EstimateMetaRecord | undefined) ?? null;
}

export async function queryEstimateMeta(
  tenantId: string,
  repoId: string,
): Promise<EstimateMetaRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `ESTMETA#${repoId}#`,
      },
    }),
  );
  return (res.Items ?? []) as EstimateMetaRecord[];
}

// ---------- Transições de etapa (tempo na etapa — Prioritization etc.) ----------
// Um registro por item+etapa com o momento da ENTRADA (reentrada sobrescreve).
// Gravado por toda mutação de etapa que passa pelo backend; itens movidos por
// fora da UI recebem um registro aproximado na reconciliação (approximate).

// Origem de uma transição: ato humano na UI (manual) ou movimento aplicado pela
// automação de eventos de PR (workspace Dev). Registros antigos não têm o campo.
export type StageOrigin = 'manual' | 'automation';

export interface StageEntryRecord {
  tenantId: string;
  repoId: string;
  stage: string; // StageName canônico
  issueNumber: number;
  at: string; // ISO — momento da entrada na etapa
  approximate: boolean;
  origin?: StageOrigin;
  sub?: string | null; // autor da transição (null em origin: automation)
}

const stageEntryKey = (t: {
  tenantId: string;
  repoId: string;
  stage: string;
  issueNumber: number;
}) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `STAGEAT#${t.repoId}#${t.stage}#${t.issueNumber}`,
});

export async function putStageEntry(rec: StageEntryRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...stageEntryKey(rec), ...rec } }),
  );
}

export async function queryStageEntries(
  tenantId: string,
  repoId: string,
  stage: string,
): Promise<StageEntryRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `STAGEAT#${repoId}#${stage}#`,
      },
    }),
  );
  return (res.Items ?? []) as StageEntryRecord[];
}

// ---------- Última transição por item (automação do workspace Dev) ----------
// Um registro por item com a transição MAIS RECENTE (etapa/quando/origem). A
// automação de eventos de PR consulta isto para nunca desfazer um movimento
// manual mais recente que a evidência de PR.

export interface StageLastRecord {
  tenantId: string;
  repoId: string;
  issueNumber: number;
  stage: string; // StageName canônico da última transição
  at: string; // ISO
  origin: StageOrigin;
  sub?: string | null; // autor (null em origin: automation)
}

const stageLastKey = (t: { tenantId: string; repoId: string; issueNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `STAGELAST#${t.repoId}#${t.issueNumber}`,
});

export async function putStageLast(rec: StageLastRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...stageLastKey(rec), ...rec } }),
  );
}

export async function queryStageLast(
  tenantId: string,
  repoId: string,
): Promise<StageLastRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `STAGELAST#${repoId}#`,
      },
    }),
  );
  return (res.Items ?? []) as StageLastRecord[];
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

// ---------- Preferências por usuário (workspace Dev) ----------
// A sessão autentica um usuário Cognito (sub); o "eu" do workspace do Developer
// é um login do GitHub. O vínculo é uma preferência por usuário do tenant.

export interface UserPrefRecord {
  tenantId: string;
  sub: string;
  githubLogin: string | null;
  slackUserId?: string | null; // member ID no Slack (convite ao canal de discussão)
  updatedAt: string; // ISO
}

const userPrefKey = (tenantId: string, sub: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `USERPREF#${sub}`,
});

export async function putUserPref(rec: UserPrefRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...userPrefKey(rec.tenantId, rec.sub), ...rec } }),
  );
}

export async function getUserPref(
  tenantId: string,
  sub: string,
): Promise<UserPrefRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: userPrefKey(tenantId, sub) }),
  );
  return (out.Item as UserPrefRecord | undefined) ?? null;
}

// ---------- Papéis de acesso (usuário × repositório) ----------
// Papéis de TRABALHO (pm/tech/dev) por membro e repositório — a materialização
// das validações "papel X (UI + backend)" das specs. O root (= owner do tenant)
// administra; múltiplos papéis por repositório são comuns (TL que desenvolve).

export interface MemberRolesRecord {
  tenantId: string;
  sub: string;
  repoId: string;
  roles: string[]; // 'pm' | 'tech' | 'dev'
  updatedAt: string; // ISO
  updatedBy: string; // sub de quem concedeu
}

const memberRolesKey = (tenantId: string, sub: string, repoId: string) => ({
  PK: `TENANT#${tenantId}`,
  SK: `MEMBERROLE#${sub}#${repoId}`,
});

export async function putMemberRoles(rec: MemberRolesRecord): Promise<void> {
  if (rec.roles.length === 0) {
    await doc().send(
      new DeleteCommand({ TableName: TABLE, Key: memberRolesKey(rec.tenantId, rec.sub, rec.repoId) }),
    );
    return;
  }
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { ...memberRolesKey(rec.tenantId, rec.sub, rec.repoId), ...rec },
    }),
  );
}

export async function getMemberRoles(
  tenantId: string,
  sub: string,
  repoId: string,
): Promise<MemberRolesRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: memberRolesKey(tenantId, sub, repoId) }),
  );
  return (out.Item as MemberRolesRecord | undefined) ?? null;
}

// Todas as atribuições do tenant (matriz do admin) ou de um membro (/api/me).
export async function queryMemberRoles(
  tenantId: string,
  sub?: string,
): Promise<MemberRolesRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': sub ? `MEMBERROLE#${sub}#` : 'MEMBERROLE#',
      },
    }),
  );
  return (res.Items ?? []) as MemberRolesRecord[];
}

// ---------- Auditoria administrativa ----------
// Mutações de administração (papéis concedidos/revogados, repositórios) — um
// registro por ato, chaveado por timestamp (leitura futura por período).

export interface AuditLogRecord {
  tenantId: string;
  at: string; // ISO
  sub: string; // autor
  action: string; // ex.: 'roles.set', 'repository.create'
  target: string; // ex.: 'sub#repoId', repoId
  detail?: string;
}

export async function putAuditLog(rec: AuditLogRecord): Promise<void> {
  await doc().send(
    new PutCommand({
      TableName: TABLE,
      Item: { PK: `TENANT#${rec.tenantId}`, SK: `AUDIT#${rec.at}#${rec.action}`, ...rec },
    }),
  );
}

// ---------- Discussão integrada (canais de chat por Feature) ----------
// Um canal por Feature (spec "Discussão integrada" §2). A unicidade da chave
// resolve a corrida de criação: o segundo clique simultâneo falha no condition
// e recebe o canal do primeiro. Citações têm dedupe por comentário.

export interface DiscussionChannelRecord {
  tenantId: string;
  repoId: string;
  itemNumber: number;
  provider: 'slack';
  channelId: string;
  channelName: string;
  createdBy: string; // sub do usuário criador
  createdAt: string; // ISO
  archivedAt: string | null;
  openingPosted: boolean; // §4.1 passo 3 (retomável)
  tracePosted: boolean; // §4.1 passo 4 (comentário na issue, uma vez por canal)
}

const discussionChannelKey = (t: { tenantId: string; repoId: string; itemNumber: number }) => ({
  PK: `TENANT#${t.tenantId}`,
  SK: `DISCCHAN#${t.repoId}#${t.itemNumber}`,
});

// Grava o mapeamento SOMENTE se ainda não existe. false = perdeu a corrida.
export async function putDiscussionChannelIfAbsent(
  rec: DiscussionChannelRecord,
): Promise<boolean> {
  try {
    await doc().send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...discussionChannelKey(rec), ...rec },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function putDiscussionChannel(rec: DiscussionChannelRecord): Promise<void> {
  await doc().send(
    new PutCommand({ TableName: TABLE, Item: { ...discussionChannelKey(rec), ...rec } }),
  );
}

export async function getDiscussionChannel(
  tenantId: string,
  repoId: string,
  itemNumber: number,
): Promise<DiscussionChannelRecord | null> {
  const out = await doc().send(
    new GetCommand({ TableName: TABLE, Key: discussionChannelKey({ tenantId, repoId, itemNumber }) }),
  );
  return (out.Item as DiscussionChannelRecord | undefined) ?? null;
}

export async function queryDiscussionChannels(
  tenantId: string,
  repoId: string,
): Promise<DiscussionChannelRecord[]> {
  const res = await doc().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':sk': `DISCCHAN#${repoId}#`,
      },
    }),
  );
  return (res.Items ?? []) as DiscussionChannelRecord[];
}

export interface DiscussionCitationRecord {
  tenantId: string;
  channelId: string;
  commentId: number;
  postedAt: string; // ISO
}

// Dedupe de citação: true = primeira vez (pode postar); false = já citado.
export async function putDiscussionCitationIfAbsent(
  rec: DiscussionCitationRecord,
): Promise<boolean> {
  try {
    await doc().send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `TENANT#${rec.tenantId}`,
          SK: `DISCCITE#${rec.channelId}#${rec.commentId}`,
          ...rec,
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
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
