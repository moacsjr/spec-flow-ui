# Infra do SaaS spec-flow-ui (AWS CDK)

Conta AWS: **458889634344** (fixada em `bin/app.ts`). Região default: `us-east-1`.

## Stacks

| Stack | Conteúdo |
|---|---|
| `SpecWaveStateful` | DynamoDB `spec-wave` (single-table, PITR, TTL), KMS CMK, 3 segredos no Secrets Manager, Cognito User Pool + Hosted UI + triggers (PostConfirmation cria tenant; PreTokenGeneration injeta `custom:tenant_id`) |
| `SpecWaveApi` | Lambda `api` (Express via serverless-http) + Lambda `webhook`, HTTP API com JWT authorizer (Cognito), throttling de stage |
| `SpecWaveWeb` | S3 privado (OAC) + CloudFront (behavior `/api/*` → HTTP API, SPA fallback) + WAF (Common, KnownBadInputs, rate limit 2000/5min por IP), deploy do `client/dist` |
| `SpecWaveObservability` | Alarmes (API 5xx, erros das Lambdas, refine p90 > 25 s, Dynamo throttles) + dashboard `spec-wave` + SNS (`-c alarmEmail=<email>` para assinar) |
| `SpecWaveCicd` | OIDC do GitHub Actions + role de deploy (só main; só assume as roles cdk-*). Deploy exige `-c githubRepo=org/repo` |

## Pré-requisitos (fase 0 — manuais, uma vez)

1. **Rotacionar a chave OpenRouter** que estava em `.env` (nunca foi commitada, mas viveu em disco).
2. **Criar o GitHub App** (Settings → Developer settings → GitHub Apps):
   - Permissions: Issues RW, Contents RW, Metadata R, Projects RW.
   - Webhook: ative; URL vem do output `WebhookUrl` do `SpecWaveApi` (dá para criar o App antes com URL placeholder e ajustar depois). Gere um **webhook secret**.
   - Eventos: `installation`, `installation_repositories`.
   - **Setup URL**: a URL do app (output `AppUrl` do `SpecWaveWeb`) — o GitHub redireciona para lá com `installation_id` + `state` após a instalação.
   - Gere e baixe a **private key** (.pem). Anote **App ID** e **slug**.
3. `npm install` na raiz do monorepo e `npx cdk bootstrap aws://458889634344/us-east-1` (uma vez por conta/região).

## Deploy (ordem)

```bash
cd infra

# 1. Stateful primeiro (Dynamo + Cognito + Secrets)
npx cdk deploy SpecWaveStateful

# 2. Preencher os segredos (valores NUNCA vão para o código):
aws secretsmanager put-secret-value --secret-id spec-wave/github-app-private-key --secret-string file://app.pem
aws secretsmanager put-secret-value --secret-id spec-wave/github-webhook-secret --secret-string '<webhook-secret>'
aws secretsmanager put-secret-value --secret-id spec-wave/openrouter-api-key --secret-string '<sk-or-...>'

# 3. API (passe o App ID/slug via contexto)
npx cdk deploy SpecWaveApi -c githubAppId=<APP_ID> -c githubAppSlug=<APP_SLUG>
#    → output WebhookUrl: configure no GitHub App.

# 4. Build do client com a config do Cognito (outputs do SpecWaveStateful)
cd ..
VITE_COGNITO_DOMAIN=https://spec-wave-458889634344.auth.us-east-1.amazoncognito.com \
VITE_COGNITO_CLIENT_ID=<UserPoolClientId> \
npm run build

# 5. Web
cd infra && npx cdk deploy SpecWaveWeb -c githubAppId=<APP_ID> -c githubAppSlug=<APP_SLUG>
#    → output AppUrl.

# 6. Amarrar as pontas com a AppUrl:
#    - Setup URL do GitHub App = AppUrl
#    - callback do Cognito: redeploy do Stateful com -c appUrl=<AppUrl>
npx cdk deploy SpecWaveStateful -c appUrl=https://<distribuicao>.cloudfront.net/
```

## Dev local (sem AWS)

```bash
docker run -d --rm -p 8000:8000 amazon/dynamodb-local
# criar a tabela spec-wave (PK/SK string) — ver server/.env.example
DEV_TENANT_ID=dev-tenant DYNAMODB_ENDPOINT=http://localhost:8000 npm run dev
```

Sem `VITE_COGNITO_*` no client, a auth fica desabilitada e o backend usa `DEV_TENANT_ID`.

## Verificação pós-deploy

1. Signup no Hosted UI → confirmação → login (claim `custom:tenant_id` presente no id token — conferir em jwt.io).
2. Dashboard → "Instalar GitHub App" → instalar num repo de teste → retorno conclui o setup.
3. Conectar o repositório → criar feature → refine → save.
4. **Isolamento**: segundo usuário (tenant B) não vê nem acessa repositórios do tenant A (lista vazia; GET por id → 404).
5. Webhook: `POST /webhooks/github` sem assinatura → 401.

## Fase 2 (implementada)

- **WAF** no CloudFront (managed rules + rate limit por IP).
- **LeadingKeys**: a Lambda api não tem acesso direto à tabela — assume `TenantDataRole` por request com session tag `tenant_id`; o IAM restringe o DynamoDB a `TENANT#<tenant>` (+ `INSTALLATION#*`/`STATE#*` do onboarding). Env `TENANT_ROLE_ARN`; falha ao assumir → 500 (nunca degrada para acesso amplo).
- **Métricas do refine**: EMF `SpecWave/RefineDurationMs` (dimensão `kind` + rollup); alarme p90 > 25 s decide a migração para Function URL/assíncrono.
- **Logs de auditoria**: linha JSON por request (`type: access`) com `tenantId`, `sub`, `requestId`, rota, status e duração — consulta por tenant via Logs Insights.
- **Webhook**: erro → 500 → o GitHub reentrega (handlers idempotentes); alarme dispara se persistir (redeliver manual na UI do App). Sem SQS por ora.
- **Testes de isolamento**: `npm -w server test` (dynamodb-local) — cross-tenant 404, lista escopada, lock de URL por tenant, 401 na borda HTTP. Rodam no CI.
- **CI/CD**: `.github/workflows/ci.yml` (typecheck + testes + build + synth) e `deploy.yml` (main → OIDC → `cdk deploy --all`). Setup: deploy do `SpecWaveCicd` e variáveis do repo (ver comentário no deploy.yml).

## Fase 3 (implementada)

- **Planos e cotas** (`server/src/lib/plans.ts`): free (2 repos, 20 refines/mês, 3 membros) e pro (25/500/25). Refine: token bucket mensal atômico (`USAGE#<mês>`, UpdateItem condicional) → 429 ao estourar. Repositórios: teto checado no cadastro → 402.
- **Stripe**: Checkout (upgrade → pro) e Customer Portal via REST (sem SDK); webhook `POST /webhooks/stripe` (Lambda própria, assinatura `t/v1` verificada, tolerância 5 min) é o ÚNICO caminho que muda o plano. Eventos a assinar no Stripe: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` (output `StripeWebhookUrl`). Segredos: `spec-wave/stripe-secret-key` e `spec-wave/stripe-webhook-secret`; price via `-c stripePricePro=price_...`; `-c appUrl=...` alimenta os redirects.
- **Multi-usuário**: convite por código (uso único, TTL 7 dias) gerado pelo owner em Configurações; convidado cria conta, abre `#/invite/<code>`, o vínculo `USER#` é reescrito para o tenant convidante e o client força re-login (claim atualiza no token novo). Roles: owner (billing, repos, convites, chave) e member (uso). Claim `custom:role` via PreTokenGeneration.
- **Chave OpenRouter por tenant**: cifrada com KMS `TenantDataKey` (EncryptionContext = tenantId) e gravada no item TENANT#. Refinos com chave própria usam a conta do tenant e NÃO consomem cota.
- **Cache ETag no proxy GitHub** (`server/src/lib/githubCache.ts`): GETs REST condicionais — 304 não consome o rate limit da instalação (corta o custo do polling).
- **LeadingKeys ampliado**: `INVITECODE#*`, `STRIPECUST#*`, `USER#*` adicionados às chaves compartilhadas da TenantDataRole.

### Setup do Stripe (uma vez)
1. Criar o produto/price recorrente do plano pro no Stripe Dashboard → anotar `price_...`.
2. `aws secretsmanager put-secret-value --secret-id spec-wave/stripe-secret-key --secret-string 'sk_live_...'`
3. Deploy do `SpecWaveApi` com `-c stripePricePro=price_... -c appUrl=https://<cloudfront>/` → output `StripeWebhookUrl`.
4. Criar o webhook endpoint no Stripe com essa URL e os 3 eventos acima → `aws secretsmanager put-secret-value --secret-id spec-wave/stripe-webhook-secret --secret-string 'whsec_...'`.

## Futuro

- **Refine assíncrono** (202 + item `JOB#` no Dynamo + polling do client): liberta o refine do teto de 29 s do HTTP API e permite voltar a modelos reasoning. Medição 2026-07-07: `deepseek-v4-pro` = 57 s (estoura); `deepseek-chat` = 7–14 s (default atual). O alarme `RefineP90 > 25 s` é o gatilho.
- Limpeza de tenants órfãos (abandonados após aceite de convite), remoção de membros pela UI, e-mail de convite (SES), cotas por membro, relatórios de uso.
