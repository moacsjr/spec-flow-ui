// Recursos com estado: tabela DynamoDB single-table, segredos (KMS CMK) e
// Cognito User Pool (signup/login + triggers que criam tenant e injetam o claim
// custom:tenant_id). Nada aqui é recriável sem perda — deletion protection ligada.

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.resolve(__dirname, '../../server/src');

export class StatefulStack extends cdk.Stack {
  readonly table: dynamodb.Table;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly secretsKey: kms.Key;
  readonly tenantDataKey: kms.Key;
  readonly githubAppPrivateKeySecret: secretsmanager.Secret;
  readonly githubWebhookSecret: secretsmanager.Secret;
  readonly openrouterSecret: secretsmanager.Secret;
  readonly stripeSecretKey: secretsmanager.Secret;
  readonly stripeWebhookSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------- DynamoDB (single-table multi-tenant) ----------
    this.table = new dynamodb.Table(this, 'Table', {
      tableName: 'spec-wave',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl', // STATE# do onboarding expira sozinho
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ---------- Segredos (KMS CMK própria) ----------
    // Valores são colocados MANUALMENTE após o deploy (private key do GitHub
    // App, webhook secret, chave OpenRouter) — nunca no código/IaC.
    this.secretsKey = new kms.Key(this, 'SecretsKey', {
      description: 'spec-wave: cifra os segredos do SaaS',
      enableKeyRotation: true,
    });
    const secretProps = {
      encryptionKey: this.secretsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    } as const;
    this.githubAppPrivateKeySecret = new secretsmanager.Secret(this, 'GithubAppPrivateKey', {
      secretName: 'spec-wave/github-app-private-key',
      description: 'PEM da private key do GitHub App (cole o conteúdo do .pem)',
      ...secretProps,
    });
    this.githubWebhookSecret = new secretsmanager.Secret(this, 'GithubWebhookSecret', {
      secretName: 'spec-wave/github-webhook-secret',
      description: 'Webhook secret do GitHub App',
      ...secretProps,
    });
    this.openrouterSecret = new secretsmanager.Secret(this, 'OpenrouterKey', {
      secretName: 'spec-wave/openrouter-api-key',
      description: 'Chave da API do OpenRouter (refino de spec/plan)',
      ...secretProps,
    });
    this.stripeSecretKey = new secretsmanager.Secret(this, 'StripeSecretKey', {
      secretName: 'spec-wave/stripe-secret-key',
      description: 'Secret key do Stripe (sk_live_/sk_test_)',
      ...secretProps,
    });
    this.stripeWebhookSecret = new secretsmanager.Secret(this, 'StripeWebhookSecret', {
      secretName: 'spec-wave/stripe-webhook-secret',
      description: 'Signing secret do webhook do Stripe (whsec_...)',
      ...secretProps,
    });

    // CMK para cifrar segredos POR TENANT (ex.: chave OpenRouter própria) antes
    // de gravar no DynamoDB. EncryptionContext = tenantId (ver settingsService).
    this.tenantDataKey = new kms.Key(this, 'TenantDataKey', {
      description: 'spec-wave: cifra segredos por tenant gravados no DynamoDB',
      enableKeyRotation: true,
    });

    // ---------- Triggers do Cognito ----------
    const triggerDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(serverSrc, 'triggers/cognito.ts'),
      environment: { TABLE_NAME: this.table.tableName, NODE_ENV: 'production' },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        // Shim p/ require() dinâmico das deps CJS (winston) no bundle ESM.
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      timeout: cdk.Duration.seconds(10),
    };
    const postConfirmationFn = new NodejsFunction(this, 'PostConfirmationFn', {
      ...triggerDefaults,
      handler: 'postConfirmation',
    });
    const preTokenGenerationFn = new NodejsFunction(this, 'PreTokenGenerationFn', {
      ...triggerDefaults,
      handler: 'preTokenGeneration',
    });
    this.table.grantReadWriteData(postConfirmationFn);
    this.table.grantReadData(preTokenGenerationFn);

    // ---------- Cognito User Pool ----------
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'spec-wave',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireDigits: true,
      },
      mfa: cognito.Mfa.OPTIONAL,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: {
        postConfirmation: postConfirmationFn,
        preTokenGeneration: preTokenGenerationFn,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const domainPrefix = this.node.tryGetContext('cognitoDomainPrefix') as string;
    this.userPool.addDomain('Domain', { cognitoDomain: { domainPrefix } });

    // Callback = raiz do app (CloudFront). Antes do primeiro deploy do WebStack
    // a URL não existe — o contexto appUrl é atualizado depois (ver README).
    // A SPA monta redirect_uri = `${window.location.origin}/`, então TODO domínio
    // por onde o app é servido precisa estar aqui (senão a Hosted UI do Cognito
    // devolve "An error was encountered with the requested page."). Domínio custom
    // (ex.: spec-wave.astratech.net.br) entra via contexto appCustomDomainUrl.
    const appUrl = (this.node.tryGetContext('appUrl') as string) || 'http://localhost:5173/';
    const customDomainUrl = this.node.tryGetContext('appCustomDomainUrl') as string | undefined;
    const oauthUrls = [appUrl, 'http://localhost:5173/', ...(customDomainUrl ? [customDomainUrl] : [])];
    this.userPoolClient = this.userPool.addClient('SpaClient', {
      generateSecret: false, // SPA pública: PKCE, sem client secret
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: oauthUrls,
        logoutUrls: oauthUrls,
      },
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://${domainPrefix}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName });
  }
}
