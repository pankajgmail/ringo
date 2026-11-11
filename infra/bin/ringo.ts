import { App } from "aws-cdk-lib";
import { RingoStack } from "../lib/ringo-stack.ts";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const googleClientId = app.node.tryGetContext("googleClientId") as string | undefined;
if (!googleClientId) throw new Error("Pass -c googleClientId=<Google OAuth web client ID> (see docs/setup.md)");
new RingoStack(app, `Ringo-${stage}`, {
  stage,
  // Explicit account/region is required when domainName is set (Route 53 lookup).
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? "us-west-2" },
  domainName: app.node.tryGetContext("domainName") as string | undefined,
  googleClientId,
});
