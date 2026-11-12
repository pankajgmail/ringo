import { App } from "aws-cdk-lib";
import { RingoStack } from "../lib/ringo-stack.ts";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const googleClientId = app.node.tryGetContext("googleClientId") as string | undefined;
// The Ringo project's AWS account (settings.aws.com → Project). Pinned so a deploy with
// other credentials fails instead of creating resources in the wrong account.
const account = app.node.tryGetContext("account") as string;
const region = app.node.tryGetContext("region") as string;
// Commands like `cdk bootstrap` run the app without a client ID; only define the stack when deploying.
if (googleClientId) {
  new RingoStack(app, `Ringo-${stage}`, {
    stage,
    env: { account, region },
    domainName: app.node.tryGetContext("domainName") as string | undefined,
    googleClientId,
  });
} else {
  console.error("No googleClientId given, so no Ringo stack is defined. Deploy with scripts/deploy.sh (see docs/setup.md).");
}
