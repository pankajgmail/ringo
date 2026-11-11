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
   - Authorized JavaScript origin: `https://ringo-<stage>-<account>.auth.us-west-2.amazoncognito.com`
   - Authorized redirect URI: `https://ringo-<stage>-<account>.auth.us-west-2.amazoncognito.com/oauth2/idpresponse`
3. Store the client secret before deploying:
   ```sh
   aws secretsmanager create-secret --name ringo/dev/google-client-secret --secret-string '<client secret>'
   ```
4. Pass the client ID to every deploy: `-c googleClientId=<id>.apps.googleusercontent.com`.

## 4. AWS

```sh
cd infra
npx cdk bootstrap
npx cdk deploy -c stage=dev -c googleClientId=…                                   # ALB URL over HTTP
npx cdk deploy -c stage=prod -c googleClientId=… -c domainName=api.example.com    # ACM + Route 53; needs a hosted zone and CDK_DEFAULT_ACCOUNT
```

The outputs give `ApiUrl`, `UserPoolId`, `UserPoolClientId`, `CognitoDomain` and `AppSecretsName`. Fill the secret (`ringo/<stage>/app`) with the Retell and Twilio keys:

```sh
aws secretsmanager put-secret-value --secret-id ringo/dev/app --secret-string '{
  "RETELL_API_KEY":"…","RETELL_OUTBOUND_AGENT_ID":"…","RETELL_BOOKING_AGENT_ID":"…","RETELL_INBOUND_AGENT_ID":"…",
  "TWILIO_ACCOUNT_SID":"…","TWILIO_AUTH_TOKEN":"…","TWILIO_VERIFY_SERVICE_SID":"…","DEFAULT_FROM_NUMBER":"+1…"}'
aws ecs update-service --cluster <cluster> --service <service> --force-new-deployment
```

The container runs DB migrations on start. DB credentials come from the RDS-generated secret, and KMS + Cognito settings are injected by the stack.

Set `PUBLIC_URL` to `ApiUrl`, then re-run `retell:setup` so webhooks and tools point at the deployed API.

## 5. App

Set these in `apps/mobile/app.json` → `extra`, or via `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_DOMAIN` and `EXPO_PUBLIC_COGNITO_CLIENT_ID`. The stack already registers `ringo://auth`, `http://localhost:8081/auth` and `https://app.<domainName>/auth` as callback URLs. Release builds always require Google; the dev bypass only works in `__DEV__` builds against an API running with `AUTH_DEV_BYPASS=true`.

- Web: `npx expo export -p web` from `apps/mobile`, then host `dist/` (S3 + CloudFront, or any static host).
- iOS / Android: `npx eas build` (requires an Expo account; add `eas.json`). Push notifications need an APNs key and FCM credentials in EAS.
