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
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

interface Props extends StackProps {
  stage: string;
  domainName?: string;
  /** Google OAuth web client ID. The client secret is passed at deploy time (see scripts/deploy.sh). */
  googleClientId: string;
}

/**
 * Ringo backend: VPC, RDS Postgres, Fargate API behind an ALB, Cognito, KMS, S3.
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
        callbackUrls: ["ringo://auth", "http://localhost:8081/auth", ...(props.domainName ? [`https://app.${props.domainName}/auth`] : [])],
        logoutUrls: ["ringo://", "http://localhost:8081/", ...(props.domainName ? [`https://app.${props.domainName}/`] : [])],
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
    const publicUrl = apiHost ? `https://${apiHost}` : "https://set-domainName-context";

    const api = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", {
      cluster,
      cpu: 512,
      memoryLimitMiB: 1024,
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
        image: ecs.ContainerImage.fromAsset(repoRoot, { file: "apps/api/Dockerfile", exclude: ["**/node_modules", "apps/mobile", "infra/cdk.out", ".git"] }),
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
        },
      },
    });
    api.targetGroup.configureHealthCheck({ path: "/health", healthyHttpCodes: "200" });
    api.targetGroup.setAttribute("deregistration_delay.timeout_seconds", "130");
    db.connections.allowDefaultPortFrom(api.service);
    dataKey.grantEncryptDecrypt(api.taskDefinition.taskRole);
    dataKey.grant(api.taskDefinition.taskRole, "kms:GenerateDataKey");
    recordings.grantReadWrite(api.taskDefinition.taskRole);

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

    new CfnOutput(this, "ApiUrl", { value: publicUrl });
    new CfnOutput(this, "LoadBalancerDns", { value: api.loadBalancer.loadBalancerDnsName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: appClient.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: domain.baseUrl() });
    new CfnOutput(this, "ParameterPath", { value: `/ringo/${props.stage}/` });
  }
}
