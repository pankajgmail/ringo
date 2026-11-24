# Setup

## 1. Twilio

1. Buy a voice-capable US number.
2. **Elastic SIP Trunking → Trunks → Create**.
   - *Termination*: set a termination URI (e.g. `ringo-dev.pstn.twilio.com`) and a credential list (username/password). These map to `TWILIO_TERMINATION_URI`, `TWILIO_SIP_USERNAME` and `TWILIO_SIP_PASSWORD`.
   - *Origination*: add `sip:sip.retellai.com` so inbound calls go to Retell.
   - Attach the number to the trunk. Put the trunk SID in `TWILIO_SIP_TRUNK_SID`.
3. **Verify → Services → Create** (SMS). Put the SID in `TWILIO_VERIFY_SERVICE_SID`.
4. Before going live, register the business in Trust Hub (SHAKEN/STIR, CNAM) so calls aren't flagged as spam.

## 2. Retell

1. Create an API key → `RETELL_API_KEY`.
2. Make `PUBLIC_URL` reachable from the internet (deployed URL, or `ngrok http 8080` locally).
3. Create or update the LLMs and agents, and import the Twilio number:
   ```sh
   npm run retell:setup -- --import +1XXXXXXXXXX
   ```
   Copy the printed agent IDs into `RETELL_OUTBOUND_AGENT_ID`, `RETELL_BOOKING_AGENT_ID` and `RETELL_INBOUND_AGENT_ID`. Set `DEFAULT_FROM_NUMBER` to the same number. Re-run the script after changing `retell/prompts.ts`.

## 3. Google sign-in

Ringo has no passwords: Google is the only way in. Cognito has self sign-up disabled and federates to Google, and the API rejects any token that isn't a Google identity with a verified email (`isGoogleSignIn` in `apps/api/src/lib/auth.ts`).

1. Google Cloud console → **APIs & Services → OAuth consent screen**. Set the app name to Ringo and add the `openid`, `email` and `profile` scopes. Publish it to production when you're ready; in testing mode only listed test users can sign in.
2. **Credentials → Create OAuth client ID → Web application**.
   - Authorized JavaScript origin: `https://ringo-<stage>-334076860223.auth.us-east-2.amazoncognito.com`
   - Authorized redirect URI: `https://ringo-<stage>-334076860223.auth.us-east-2.amazoncognito.com/oauth2/idpresponse`
3. Store the client secret in Parameter Store (next section) as `/ringo/<stage>/google-client-secret`.

## 4. Secrets (SSM Parameter Store)

Ringo deploys to AWS account `334076860223` in **US East (Ohio) `us-east-2`**, pinned in `infra/cdk.json`. All secrets are **SecureString** parameters under `/ringo/<stage>/` in that region. They are encrypted with KMS (`alias/aws/ssm`). Create them **before the first deploy**; ECS reads them each time a task starts.

| Parameter | Value |
|---|---|
| `google-client-secret` | Google OAuth client secret (`GOCSPX-…`) |
| `db-password` | Postgres password: letters and digits, 20+ characters (`openssl rand -hex 24`) |
| `RETELL_API_KEY` | Retell API key |
| `RETELL_OUTBOUND_AGENT_ID`, `RETELL_BOOKING_AGENT_ID`, `RETELL_INBOUND_AGENT_ID` | Printed by `npm run retell:setup` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Twilio console |
| `DEFAULT_FROM_NUMBER` | Your Twilio number, e.g. `+14155550142` |
| `GOOGLE_PLACES_API_KEY` | Google Places API (New) key for business search in New call. Restrict it to Places API (New). `unset` = only national brands are searchable |
| `TWILIO_SIP_TRUNK_SID`, `TWILIO_TERMINATION_URI`, `TWILIO_SIP_USERNAME`, `TWILIO_SIP_PASSWORD` | SIP trunk (section 1), used to buy per-user Ringo numbers and import them into Retell |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe secret key and webhook signing secret (section 7). `-` = billing off, calls unlimited |

**Console:** Systems Manager → **Parameter Store** → **Create parameter**. Set the name to e.g. `/ringo/dev/google-client-secret`, Tier **Standard**, Type **SecureString**, KMS key **My current account** (`alias/aws/ssm`), paste the bare value, and click **Create parameter**.

**CLI:**
```sh
REGION=us-east-2
aws ssm put-parameter --region $REGION --type SecureString --name /ringo/dev/google-client-secret --value 'GOCSPX-…'
aws ssm put-parameter --region $REGION --type SecureString --name /ringo/dev/db-password --value "$(openssl rand -hex 24)"
aws ssm put-parameter --region $REGION --type SecureString --name /ringo/dev/RETELL_API_KEY --value 'key_…'
# …one per row above. If you don't have a value yet, store `unset` and update it later.
```

To change a value later, add `--overwrite`, then restart the API (`aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment`). If you change `google-client-secret`, run the deploy again instead.

Don't change `db-password` after the first deploy. The database keeps the original password, so a new value would lock the API out.

## 5. AWS deploy

```sh
cd infra
npx cdk bootstrap aws://334076860223/us-east-2
STAGE=dev  GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com npm run deploy                     # ALB URL over HTTP
STAGE=prod GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com DOMAIN=example.com npm run deploy  # api.example.com with ACM + Route 53
```

`scripts/deploy.sh` checks that you're signed in to account `334076860223`. It then reads `google-client-secret` from Parameter Store and passes it to CloudFormation as a hidden (NoEcho) parameter, because Cognito can't read Parameter Store directly.

The outputs give `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain` and `ParameterPath`. The container runs DB migrations on start. RDS gets its password from `db-password`, and KMS + Cognito settings are injected by the stack.

Set `PUBLIC_URL` to the HTTPS URL (`ApiUrl` with a custom domain, otherwise the CloudFront `WebUrl`), then re-run `retell:setup` so webhooks and tools point at the deployed API. Retell only calls HTTPS. Each `ask_user` / `wait_for_answer` request returns within 50 s, inside CloudFront's 60 s origin timeout; longer waits are chained.

Optional CDK context (`-c key=value`, or `RINGO_CDK_EXTRA` in the deploy scripts):

| Context | Effect |
|---|---|
| `adminEmails` | Comma-separated emails that can open the admin dashboard |
| `smsFrom` | Number mid-call questions are texted from (default `DEFAULT_FROM_NUMBER`) |
| `whatsappFrom`, `whatsappJoin` | WhatsApp sender (`whatsapp:+14155238886` for the sandbox) and its join phrase, spaces as `_` |
| `appleTeamId`, `appleKeyId`, `appleServicesId` | Sign in with Apple (see [store-launch.md](store-launch.md)) |
| `domainName` | Custom domain: `api.<domain>` and `app.<domain>` with ACM + Route 53 |

The web app is served at the `WebUrl` output. `npm run deploy` builds it (`expo export --platform web`) and uploads it; on the very first deploy it is skipped because the Cognito client ID doesn't exist yet, so run the deploy a second time.

## 6. App

Set these in `apps/mobile/app.json` → `extra`, or via `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_DOMAIN` and `EXPO_PUBLIC_COGNITO_CLIENT_ID`. The stack already registers `ringo://auth`, `http://localhost:8081/auth` and `https://app.<domainName>/auth` as callback URLs. Release builds always require Google; the dev bypass only works in `__DEV__` builds against an API running with `AUTH_DEV_BYPASS=true`.

- Web: `npx expo export -p web` from `apps/mobile`, then host `dist/` (S3 + CloudFront, or any static host).
- iOS / Android: EAS builds and store submission, step by step in [store-launch.md](store-launch.md).

## 7. Stripe billing

5 free calls, then $9.99/month (`FREE_CALLS`, `PLAN_PRICE_CENTS` in `packages/shared/src/domain.ts`).

1. In the Stripe dashboard, go to **Developers → API keys**. Copy the secret key: `sk_test_…` to try it, `sk_live_…` for real payments.
2. Run `sh ~/ringo-billing-deploy.sh` in Terminal. It stores the key, creates the webhook endpoint `<url>/v1/webhooks/stripe` (checkout and subscription events), stores its signing secret and redeploys.
3. Turn on the **Customer Portal** (Settings → Billing → Customer portal) so "Manage subscription" works. Allow cancel and payment-method updates.

## 8. Text replies (SMS / WhatsApp)

- **SMS**:
  - The sending number's *A message comes in* webhook must be `<url>/v1/webhooks/twilio/message` (POST). The billing deploy script sets it.
  - US delivery needs **A2P 10DLC**: Twilio Console → Messaging → Regulatory compliance. Register the brand, then a campaign (use case "Customer care" / "Account notifications"). Sample messages are in `questionText` (`apps/api/src/services/messaging.ts`). Opt-out handles STOP and HELP. Add the number to the campaign's messaging service.
- **WhatsApp sandbox**:
  - Twilio Console → Messaging → Try it out → WhatsApp. Set *When a message comes in* to the same URL (POST).
  - Deploy with `-c whatsappFrom=whatsapp:+14155238886 -c whatsappJoin=join_your-words`.
  - Each user sends the join phrase once; Settings shows it.

## 9. Google Calendar

Calendar connect uses the same Google OAuth web client as sign-in.

1. In Google Cloud, go to **APIs & Services → Library** and enable the **Google Calendar API**.
2. On the OAuth client, add the authorized redirect URI `<PUBLIC_URL>/v1/calendar/callback`.
3. Add the scopes `calendar.freebusy` and `calendar.events` on the consent screen. Sensitive scopes need Google verification before public launch; until then, add test users.
