// Frontend: S3 privado (OAC) + CloudFront + WAF. Behavior default serve a SPA;
// /api/* e /status vão para o HTTP API (mesma origem → sem CORS, e o header
// Authorization chega intacto na API). WAF (fase 2): managed rules Common +
// KnownBadInputs + rate limit por IP. Escopo CLOUDFRONT exige us-east-1 —
// a região default do app já é us-east-1 (bin/app.ts).

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

export interface WebStackProps extends cdk.StackProps {
  httpApi: apigwv2.HttpApi;
}

export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Origin do HTTP API: domínio execute-api sem o esquema.
    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', props.httpApi.apiEndpoint));
    const apiOrigin = new origins.HttpOrigin(apiDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Repassa tudo (inclusive Authorization) exceto o Host — obrigatório para
      // o API Gateway resolver o stage.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    // ---------- WAF (fase 2) ----------
    const managedRule = (name: string, priority: number): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: { vendorName: 'AWS', name },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: name,
        sampledRequestsEnabled: true,
      },
    });
    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'spec-wave-web-acl',
        sampledRequestsEnabled: true,
      },
      rules: [
        managedRule('AWSManagedRulesCommonRuleSet', 0),
        managedRule('AWSManagedRulesKnownBadInputsRuleSet', 1),
        {
          name: 'RateLimitPerIp',
          priority: 2,
          action: { block: {} },
          statement: {
            // 2000 requests / 5 min por IP — folga ampla para o polling da UI,
            // barra abuso volumétrico antes do throttling do API GW.
            rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitPerIp',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ---------- Domínio custom (ex.: spec-wave.astratech.net.br) ----------
    // DNS na GoDaddy (externo ao Route53): o CDK gerencia o cert ACM e associa o
    // domínio à distribution; os registros DNS são criados no painel da GoDaddy.
    // O cert PRECISA estar em us-east-1 (escopo CloudFront) — o app já é us-east-1.
    // Se já existe um cert (o domínio custom hoje já resolve p/ o CloudFront),
    // informe o ARN em appCustomDomainCertArn para IMPORTAR e evitar re-validação.
    const customDomain = this.node.tryGetContext('appCustomDomain') as string | undefined;
    const customDomainCertArn = this.node.tryGetContext('appCustomDomainCertArn') as string | undefined;
    let domainNames: string[] | undefined;
    let certificate: acm.ICertificate | undefined;
    if (customDomain) {
      domainNames = [customDomain];
      certificate = customDomainCertArn
        ? acm.Certificate.fromCertificateArn(this, 'SiteCert', customDomainCertArn)
        : new acm.Certificate(this, 'SiteCert', {
            domainName: customDomain,
            // Validação DNS: adicione o CNAME de validação na GoDaddy. O deploy
            // fica pendente até o ACM validar (pode levar alguns minutos).
            validation: acm.CertificateValidation.fromDns(),
          });
    }

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      webAclId: webAcl.attrArn,
      domainNames,
      certificate,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': apiBehavior,
        '/status': apiBehavior,
      },
      defaultRootObject: 'index.html',
      // SPA com hash-router: 403/404 do S3 voltam ao index.html.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Publica o build do client (rode `npm run build` com as VITE_COGNITO_* antes).
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(clientDist)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${distribution.distributionDomainName}/`,
      description: 'URL do app — use como appUrl (contexto CDK) e Setup URL do GitHub App',
    });

    if (customDomain) {
      new cdk.CfnOutput(this, 'CustomDomainUrl', {
        value: `https://${customDomain}/`,
        description: 'URL do app no domínio custom',
      });
      new cdk.CfnOutput(this, 'CustomDomainCnameTarget', {
        value: distribution.distributionDomainName,
        description: 'Alvo do CNAME na GoDaddy: spec-wave.astratech.net.br -> este valor',
      });
    }
  }
}
