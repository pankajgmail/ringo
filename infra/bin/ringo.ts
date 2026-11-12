import { App } from "aws-cdk-lib";
import { RingoStack } from "../lib/ringo-stack.ts";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const googleClientId = app.node.tryGetContext("googleClientId") as string | undefined;
if (!googleClientId) throw new Error("Pass -c googleClientId=<Google OAuth web client ID> (see docs/setup.md)");
// The Ringo project's AWS account (settings.aws.com → Project). Pinned so a deploy with
// other credentials fails instead of creating resources in the wrong account.
const account = app.node.tryGetContext("account") as string;
const region = app.node.tryGetContext("region") as string;
new RingoStack(app, `Ringo-${stage}`, {
  stage,
  env: { account, region },
  domainName: app.node.tryGetContext("domainName") as string | undefined,
  googleClientId,
});
