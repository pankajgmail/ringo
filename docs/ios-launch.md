# Ringo iOS launch

The iOS app is the same Expo code as the web app (`apps/mobile`), built in the cloud with EAS. No Mac/Xcode needed.

## Security in place

| Area | What Ringo does |
|---|---|
| Sign-in | Google or Apple only, through Cognito (OAuth code + PKCE). No passwords. API rejects any other identity. |
| Tokens on the phone | iOS Keychain, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` (not in iCloud or backups). Private browser session for sign-in. 1-hour ID token, 30-day refresh token, revoked on sign-out. |
| Network | HTTPS only (App Transport Security, no exceptions; Android cleartext off). Load balancer accepts CloudFront only. Retell webhooks over HTTPS, signature-checked. |
| Firewall | AWS WAF on the API: AWS common rules, known bad inputs, IP reputation list, 3000 requests / 5 min per IP. |
| API | Every query scoped to the signed-in user. Rate limits on calls (20/h), phone codes (5/h), search (120/min), deletion. CORS only for Ringo's own origin. `no-store` on responses. Sign-in tokens redacted from logs. |
| Web | HSTS, strict Content Security Policy, no framing, no referrer leaks, Permissions-Policy. |
| Data | Encrypted at rest (KMS: database, recordings) and in transit. Recordings expire after 90 days. Account numbers and PINs are never stored: the agent asks you mid-call. |
| Deletion | Settings → Delete my account permanently deletes the user, calls, messages, Retell recordings/transcripts and the Cognito sign-in (App Store 5.1.1(v)). |
| Privacy | Apple privacy manifest (no tracking), `/privacy.html` and `/terms.html`, contacts used only for the one you pick. |
| Calls | Ringo says it's an AI and that the call may be recorded; it hangs up if the other side refuses recording. Emergency and premium numbers blocked. Monthly budget and 2 concurrent calls per user. |

## What you need

1. **Apple Developer Program**: $99/year at developer.apple.com/programs (individual or company; a company needs a D-U-N-S number).
2. **Expo account** (free) at expo.dev.
3. An iPhone for testing (TestFlight).

## Steps

### 1. Sign in with Apple (required, guideline 4.8)
On developer.apple.com → Certificates, IDs & Profiles:
1. **Identifiers → App IDs**: `app.ringo.mobile`, enable *Sign in with Apple*.
2. **Identifiers → Services IDs**: e.g. `app.ringo.signin`. Enable Sign in with Apple, primary App ID `app.ringo.mobile`.
   - Domain: `ringo-dev-334076860223.auth.us-east-2.amazoncognito.com`
   - Return URL: `https://ringo-dev-334076860223.auth.us-east-2.amazoncognito.com/oauth2/idpresponse`
3. **Keys**: new key with *Sign in with Apple*, download `AuthKey_XXXX.p8`, note the Key ID.
4. Your **Team ID** is at the top right of the developer site.

Then run: `sh ~/ringo-apple-setup.sh TEAM_ID KEY_ID app.ringo.signin ~/Downloads/AuthKey_XXXX.p8`

### 2. First build
```
cd /tmp/ringo-src/apps/mobile
npx eas-cli login
npx eas-cli init              # links the project, adds the push projectId
npx eas-cli build -p ios --profile production
```
EAS asks to sign in with your Apple ID and creates the certificates, provisioning profile and push key (APNs) for you.

### 3. TestFlight
`npx eas-cli submit -p ios --latest` uploads to App Store Connect. Add yourself as a tester and install from the TestFlight app.

### 4. App Store listing
In App Store Connect:
- **Privacy Policy URL**: `https://dhab8f4nxogwy.cloudfront.net/privacy.html`
- **App Privacy**: Data linked to you, used for App Functionality, not used for tracking: Name, Email, Phone, Physical address, Audio, Other user content (call transcripts), Contacts, User ID, Device ID.
- **Review notes**: explain that Ringo places calls to businesses you choose with an AI voice that discloses itself. Give the reviewer a demo account (a Google account with a verified test phone) and a safe test number to call.
- Age rating 4+; category Productivity.

## Before public launch
- Rotate the Retell, Twilio and Google keys that were shared in chat; restrict the Google key to the Places API.
- Legal review of `privacy.html` / `terms.html`, call recording (all-party consent states) and TCPA.
- Custom domain (e.g. `ringo.app`): set `-c domainName=…` for an ACM certificate, then update the URLs above.
- A `prod` stack (`-c stage=prod`): Multi-AZ database, deletion protection, 14-day backups.
