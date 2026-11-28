import { App } from "aws-cdk-lib";
import { RingoStack } from "../lib/ringo-stack.ts";
import { RingVoSiteStack } from "../lib/site-stack.ts";

const app = new App();
const stage = (app.node.tryGetContext("stage") as string) ?? "dev";
const googleClientId = app.node.tryGetContext("googleClientId") as string | undefined;
// The Ringo project's AWS account (settings.aws.com → Project). Pinned so a deploy with
// other credentials fails instead of creating resources in the wrong account.
const account = app.node.tryGetContext("account") as string;
const region = app.node.tryGetContext("region") as string;
// `cdk bootstrap` and `cdk synth` don't need a real client ID; scripts/deploy.sh always passes one.
new RingoStack(app, `Ringo-${stage}`, {
  stage,
  env: { account, region },
  domainName: app.node.tryGetContext("domainName") as string | undefined,
  googleClientId: googleClientId ?? "set-googleClientId.apps.googleusercontent.com",
  // -c appleTeamId=… -c appleKeyId=… -c appleServicesId=…  (see docs/store-launch.md)
  apple: app.node.tryGetContext("appleTeamId")
    ? { teamId: app.node.tryGetContext("appleTeamId"), keyId: app.node.tryGetContext("appleKeyId"), servicesId: app.node.tryGetContext("appleServicesId") }
    : undefined,
});

// Marketing site (apps/site). Deploy on its own: cdk deploy RingVo-site
new RingVoSiteStack(app, "RingVo-site", { env: { account, region } });
