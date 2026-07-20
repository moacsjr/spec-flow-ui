// Configuração central — lida exclusivamente de variáveis de ambiente.
// Segredos (private key do GitHub App, webhook secret, chave OpenRouter) vêm do
// Secrets Manager em produção (ARNs abaixo) com fallback para env var em dev
// local (ver lib/secrets.ts). Nenhum segredo é hard-coded.
//
// Para carregar um arquivo .env em dev, rode com `tsx --env-file-if-exists=.env`.

export const config = {
  port: Number(process.env.PORT ?? 3001),
  // Limite de itens retornados pela listagem (spec: até 50 por página).
  pageLimit: 50,

  // DynamoDB single-table (multi-tenant). Em dev local, DYNAMODB_ENDPOINT pode
  // apontar para um dynamodb-local (http://localhost:8000).
  tableName: process.env.TABLE_NAME ?? 'spec-wave',
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT || undefined,

  // GitHub App — credencial por tenant. O servidor troca (appId + private key)
  // por installation tokens curtos em runtime; nunca há token global de repo.
  github: {
    appId: process.env.GITHUB_APP_ID ?? '',
    appSlug: process.env.GITHUB_APP_SLUG ?? '',
    privateKeySecretArn: process.env.GITHUB_APP_PRIVATE_KEY_SECRET_ARN ?? '',
    webhookSecretArn: process.env.GITHUB_WEBHOOK_SECRET_ARN ?? '',
    // Dev local (sem AWS): PEM/segredo direto no env. Precedem os ARNs.
    privateKeyPem: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    team: process.env.GITHUB_TEAM ?? '',
  },

  // LLM via OpenRouter — usada no refino interativo de spec.md/plan.md pela UI.
  openrouter: {
    secretArn: process.env.OPENROUTER_SECRET_ARN ?? '',
    apiKey: process.env.OPENROUTER_API_KEY ?? '', // dev local
    // Default não-reasoning: medido em 2026-07-07, deepseek-v4-pro (reasoning)
    // levou 57 s — estoura o teto de 29 s do HTTP API; deepseek-chat fez a mesma
    // tarefa em 7–14 s. Refine assíncrono (202+job+polling) fica como melhoria.
    model: process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat',
    // Teto de saída do refino. Generoso para caber o documento inteiro + o
    // raciocínio dos modelos reasoning.
    maxTokens: Number(process.env.OPENROUTER_MAX_TOKENS ?? 8000),
  },

  // URL pública do app (CloudFront) — usada nos redirects do Stripe Checkout.
  appUrl: process.env.APP_URL ?? 'http://localhost:5173/',

  // Billing via Stripe (fase 3). Segredos no Secrets Manager (prod) ou env (dev).
  stripe: {
    secretArn: process.env.STRIPE_SECRET_ARN ?? '',
    secretKey: process.env.STRIPE_SECRET_KEY ?? '', // dev local
    webhookSecretArn: process.env.STRIPE_WEBHOOK_SECRET_ARN ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '', // dev local
    priceIdPro: process.env.STRIPE_PRICE_PRO ?? '', // price do plano pro (recorrente)
  },

  // KMS para cifrar segredos POR TENANT (ex.: chave OpenRouter própria) antes de
  // gravar no DynamoDB. Vazio (dev) → armazenamento recusado com 503.
  tenantKmsKeyId: process.env.TENANT_KMS_KEY_ID ?? '',

  // Hardening LeadingKeys (fase 2): role assumida por request com session tag
  // tenant_id — o IAM restringe o DynamoDB às chaves do tenant. Vazio = desligado.
  tenantRoleArn: process.env.TENANT_ROLE_ARN ?? '',

  // Dev local SEM Cognito: define um tenant fixo para o middleware de auth.
  // Ignorado quando NODE_ENV=production (nunca ativa em produção).
  devTenantId: process.env.NODE_ENV === 'production' ? '' : (process.env.DEV_TENANT_ID ?? ''),

  // Gestão de papéis (spec "Gestão de usuários e perfis de acesso"): quando
  // ativa, as escritas exigem o papel da tela (pm/tech/dev) por repositório e a
  // leitura exige algum papel (ou owner). AUTH_ENFORCED=false = modo de
  // transição (comportamento legado de switcher livre enquanto o owner popula
  // os papéis) — remover após a virada.
  authEnforced: process.env.AUTH_ENFORCED !== 'false',
};
