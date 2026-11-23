import { CfnOutput, CfnParameter, Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as rds from "aws-cdk-lib/aws-rds";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { existsSync } from "node:fs";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

interface Props extends StackProps {
  stage: string;
  domainName?: string;
  /** Google OAuth web client ID. The client secret is passed at deploy time (see scripts/deploy.sh). */
  googleClientId: string;
}

/**
 * Ringo: VPC, RDS Postgres, Fargate API behind an ALB, Cognito, KMS, S3, and a CloudFront
 * distribution that serves the web app and proxies the API over HTTPS on the same origin.
 * One stack per stage (dev / prod).
 *
 * Secrets live in SSM Parameter Store as SecureStrings under `/ringo/{stage}/` (see docs/setup.md).
 * They must exist before deploying.
 */
export class RingoStack extends Stack {
  // Fixed zones so synth needs no AWS lookup (the region is pinned in cdk.json).
  override get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);
    const prod = props.stage === "prod";
    const param = (name: string) => `/ringo/${props.stage}/${name}`;

    const vpc = new ec2.Vpc(this, "Vpc", { maxAzs: 2, natGateways: prod ? 2 : 1 });

    // ---------- Encryption ----------
    const dataKey = new kms.Key(this, "DataKey", {
      alias: `ringo-${props.stage}-data`,
      enableKeyRotation: true,
      description: "Envelope key for account numbers / PINs",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ---------- Database ----------
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: prod ? ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM) : ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      databaseName: "ringo",
      // RDS resolves the SecureString at deploy time; CloudFormation never stores the value.
      credentials: rds.Credentials.fromPassword("ringo", SecretValue.ssmSecure(param("db-password"))),
      multiAz: prod,
      allocatedStorage: 20,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      backupRetention: Duration.days(prod ? 14 : 1),
      deletionProtection: prod,
      removalPolicy: prod ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      enablePerformanceInsights: prod,
      parameters: { "rds.force_ssl": "1" },
    });

    // ---------- Recordings ----------
    const recordings = new s3.Bucket(this, "Recordings", {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !prod,
    });

    // ---------- Web app (CloudFront) ----------
    // One HTTPS origin for the browser: the exported Expo web app from S3, and the API behind
    // /v1, /retell and /health. Same origin means no CORS and no mixed content, even without a
    // custom domain. The ALB origin is added once the API exists (below).
    const webBucket = new s3.Bucket(this, "Web", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // The web export is a single-page app (app.json web.output = "single"): serve index.html for
    // every route without a file extension (/auth, /call/123) and let Expo Router take over.
    const rewrite = new cloudfront.Function(this, "WebRewrite", {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var r = event.request;
  if (r.uri.lastIndexOf(".") <= r.uri.lastIndexOf("/")) r.uri = "/index.html";
  return r;
}`),
    });
    const web = new cloudfront.Distribution(this, "WebCdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{ function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      errorResponses: [{ httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) }],
    });
    const webUrl = `https://${web.distributionDomainName}`;

    // ---------- Auth: Google sign-in only ----------
    // No self sign-up and no passwords: the only way to get a user is to sign in with Google.
    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: `ringo-${props.stage}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.NONE,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    // Cognito can't resolve ssm-secure references, so scripts/deploy.sh reads the secret from
    // Parameter Store and passes it as a NoEcho parameter (masked in the console and APIs).
    const googleSecret = new CfnParameter(this, "GoogleClientSecret", {
      type: "String",
      noEcho: true,
      description: `Google OAuth client secret, from ${param("google-client-secret")}`,
    });
    const google = new cognito.UserPoolIdentityProviderGoogle(this, "Google", {
      userPool,
      clientId: props.googleClientId,
      clientSecretValue: SecretValue.cfnParameter(googleSecret),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        emailVerified: cognito.ProviderAttribute.other("email_verified"),
        fullname: cognito.ProviderAttribute.GOOGLE_NAME,
      },
    });
    const domain = userPool.addDomain("Hosted", { cognitoDomain: { domainPrefix: `ringo-${props.stage}-${this.account}` } });
    const appClient = userPool.addClient("App", {
      generateSecret: false, // public client (mobile + web), PKCE
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.GOOGLE],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: ["ringo://auth", "http://localhost:8081/auth", `${webUrl}/auth`, ...(props.domainName ? [`https://app.${props.domainName}/auth`] : [])],
        logoutUrls: ["ringo://", "http://localhost:8081/", `${webUrl}/`, ...(props.domainName ? [`https://app.${props.domainName}/`] : [])],
      },
      preventUserExistenceErrors: true,
    });
    appClient.node.addDependency(google);

    // ---------- Third-party secrets (SecureString parameters, read by ECS when the task starts) ----------
    const s = (name: string) =>
      ecs.Secret.fromSsmParameter(ssm.StringParameter.fromSecureStringParameterAttributes(this, `Param${name}`, { parameterName: param(name) }));

    // ---------- API ----------
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });
    const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
    // Retell only calls HTTPS endpoints, so production needs a domain (Route 53 hosted zone) for the ACM cert.
    const zone = props.domainName ? route53.HostedZone.fromLookup(this, "Zone", { domainName: props.domainName }) : undefined;
    const apiHost = props.domainName ? `api.${props.domainName}` : undefined;
    // Without a custom domain, the API is reached over HTTPS through the CloudFront distribution.
    const publicUrl = apiHost ? `https://${apiHost}` : webUrl;

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
      // Graviton: cheaper, and matches images built on Apple Silicon Macs.
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      // Single task until the live hub uses LISTEN/NOTIFY (see docs/architecture.md).
      desiredCount: 1,
      minHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      publicLoadBalancer: true,
      ...(zone && apiHost
        ? { domainName: apiHost, domainZone: zone, protocol: elbv2.ApplicationProtocol.HTTPS, redirectHTTP: true,
            certificate: new acm.Certificate(this, "ApiCert", { domainName: apiHost, validation: acm.CertificateValidation.fromDns(zone) }) }
        : {}),
      idleTimeout: Duration.seconds(300), // WebSockets + ask_user long-poll
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(repoRoot, { file: "apps/api/Dockerfile", platform: Platform.LINUX_ARM64, exclude: ["**/node_modules", "apps/mobile", "infra/cdk.out", ".git"] }),
        containerPort: 8080,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logRetention: logs.RetentionDays.ONE_MONTH }),
        environment: {
          NODE_ENV: "production",
          PORT: "8080",
          PUBLIC_URL: publicUrl,
          COGNITO_USER_POOL_ID: userPool.userPoolId,
          COGNITO_CLIENT_ID: appClient.userPoolClientId,
          KMS_KEY_ID: dataKey.keyArn,
          RECORDINGS_BUCKET: recordings.bucketName,
          AUTH_DEV_BYPASS: "false",
          DB_HOST: db.dbInstanceEndpointAddress,
          DB_PORT: db.dbInstanceEndpointPort,
          DB_NAME: "ringo",
          DB_USER: "ringo",
        },
        secrets: {
          DB_PASSWORD: s("db-password"),
          RETELL_API_KEY: s("RETELL_API_KEY"),
          RETELL_OUTBOUND_AGENT_ID: s("RETELL_OUTBOUND_AGENT_ID"),
          RETELL_BOOKING_AGENT_ID: s("RETELL_BOOKING_AGENT_ID"),
          RETELL_INBOUND_AGENT_ID: s("RETELL_INBOUND_AGENT_ID"),
          TWILIO_ACCOUNT_SID: s("TWILIO_ACCOUNT_SID"),
          TWILIO_AUTH_TOKEN: s("TWILIO_AUTH_TOKEN"),
          TWILIO_VERIFY_SERVICE_SID: s("TWILIO_VERIFY_SERVICE_SID"),
          DEFAULT_FROM_NUMBER: s("DEFAULT_FROM_NUMBER"),
          GOOGLE_PLACES_API_KEY: s("GOOGLE_PLACES_API_KEY"),
        },
      },
    });
    api.targetGroup.configureHealthCheck({ path: "/health", healthyHttpCodes: "200" });
    api.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "130");
    db.connections.allowDefaultPortFrom(api.service);
    dataKey.grantEncryptDecrypt(api.taskDefinition.taskRole);
    dataKey.grant(api.taskDefinition.taskRole, "kms:GenerateDataKey");
    recordings.grantReadWrite(api.taskDefinition.taskRole);

    // ---------- Web app: API behind CloudFront ----------
    const apiOrigin = new origins.LoadBalancerV2Origin(api.loadBalancer, {
      protocolPolicy: apiHost ? cloudfront.OriginProtocolPolicy.HTTPS_ONLY : cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      // 60s is CloudFront's default ceiling. Retell's ask_user tool waits up to 90s, so leave Retell's
      // webhook and tool URLs on the ALB until that quota is raised.
      readTimeout: Duration.seconds(60),
      keepaliveTimeout: Duration.seconds(60),
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Forward everything except Host: the ALB routes on its own name, and Retell signs the raw body.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };
    for (const path of ["/v1/*", "/retell/*", "/health"]) web.addBehavior(path, apiOrigin, apiBehavior);

    // Upload the exported web app if it has been built (scripts/deploy.sh builds it first).
    const webDist = fileURLToPath(new URL("../../apps/mobile/dist", import.meta.url));
    if (existsSync(webDist)) {
      new s3deploy.BucketDeployment(this, "WebDeploy", {
        sources: [s3deploy.Source.asset(webDist)],
        destinationBucket: webBucket,
        distribution: web,
        distributionPaths: ["/*"],
        memoryLimit: 512,
      });
    }

    // ---------- Alarms ----------
    new cloudwatch.Alarm(this, "Api5xx", {
      metric: api.loadBalancer.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: Duration.minutes(5) }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: "API 5xx — webhooks or tools may be failing mid-call",
    });
    new cloudwatch.Alarm(this, "ApiUnhealthy", {
      metric: api.targetGroup.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      threshold: 1,
      evaluationPeriods: 2,
      alarmDescription: "No healthy API task — inbound calls and live outbound calls are affected",
    });

    new CfnOutput(this, "WebUrl", { value: webUrl });
    new CfnOutput(this, "WebBucket", { value: webBucket.bucketName });
    new CfnOutput(this, "WebDistributionId", { value: web.distributionId });
    new CfnOutput(this, "ApiUrl", { value: publicUrl });
    new CfnOutput(this, "LoadBalancerDns", { value: api.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: appClient.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "ParameterPath", { value: `/ringo/${props.stage}/` });
  }
}
