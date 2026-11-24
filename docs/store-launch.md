# Ringo store launch: iOS (App Store) and Android (Google Play)

Both apps are the same Expo code as the web app (`apps/mobile`). EAS builds them in the cloud, so you don't need Xcode or Android Studio.

| | |
|---|---|
| App name | Ringo |
| Bundle ID / package | `app.ringo.mobile` |
| Version | 1.1.0. Build numbers come from EAS (`appVersionSource: remote`, `autoIncrement`). |
| Privacy policy | `https://dhab8f4nxogwy.cloudfront.net/privacy.html` |
| Terms | `https://dhab8f4nxogwy.cloudfront.net/terms.html` |
| Support | `support@ringo.app` (make sure this inbox exists) |
| Account deletion | In the app: Settings → Delete my account. Web: the same, at the CloudFront URL. |

## Ready in the code

- Store icons: an opaque 1024 px App Store icon; Android adaptive icon (foreground, background, monochrome for themed icons); a white notification icon; a splash screen.
- Push notifications: the Android channel `calls` is high priority. Tapping a notification opens the call, even when the app was closed.
- Permissions are the minimum: contacts (only when you pick one) and notifications. Android blocks microphone, camera, location, phone state and storage. iOS ships a privacy manifest with no tracking, and declares no non-exempt encryption.
- Settings has Privacy, Terms, Help & support, the app version, Send feedback, and an auto-renew disclosure next to the plan.
- 4–5 star feedback opens the system "Rate this app" sheet.
- SMS: STOP and HELP are handled, and the privacy policy says mobile numbers aren't shared.

## Security in place

| Area | What Ringo does |
|---|---|
| Sign-in | Google or Apple only, through Cognito (OAuth code + PKCE). No passwords. The API rejects any other identity. |
| Tokens on the phone | iOS Keychain / Android Keystore, this device only (not in iCloud or backups). A private browser session for sign-in. 1-hour ID token, 30-day refresh token, revoked on sign-out. |
| Network | HTTPS only: App Transport Security with no exceptions; Android cleartext off. The load balancer accepts only CloudFront. All webhooks are signature-checked. |
| Firewall | AWS WAF: common rules, known bad inputs, IP reputation, 3000 requests / 5 min per IP. |
| Data | Encrypted at rest (KMS) and in transit. Recordings expire after 90 days. Account numbers and PINs are never stored. |
| Deletion | Permanently deletes the user, calls, messages, Retell recordings and transcripts, the Ringo number, the calendar link, the Stripe subscription and the sign-in. |
| Calls | Ringo says it's an AI and that the call may be recorded. Emergency and premium numbers are blocked. Monthly budget, 2 concurrent calls per user. |

## Accounts you need

1. **Expo** (free), at expo.dev.
2. **Apple Developer Program** ($99/year), at developer.apple.com/programs. A company account needs a D-U-N-S number.
3. **Google Play Console** ($25 once), at play.google.com/console. New personal accounts must run a closed test with 12 testers for 14 days before production. Organization accounts skip this.

## 1. Link the project to EAS (once)

```sh
cd /tmp/ringo-src/apps/mobile
npx eas-cli login
npx eas-cli init          # creates the EAS project and writes extra.eas.projectId into app.json (needed for push)
```
Commit the `app.json` change.

## 2. Sign in with Apple (do this before the first production build)

Production builds show "Sign in with Apple" (`EXPO_PUBLIC_APPLE_SIGN_IN=true` in `eas.json`). Apple requires it next to Google (guideline 4.8). Cognito must know about Apple first.

At developer.apple.com → Certificates, IDs & Profiles:
1. **Identifiers → App IDs**: `app.ringo.mobile`, with *Sign in with Apple* enabled.
2. **Identifiers → Services IDs**: e.g. `app.ringo.signin`, with Sign in with Apple enabled.
   - Domain: `ringo-dev-334076860223.auth.us-east-2.amazoncognito.com`
   - Return URL: `https://ringo-dev-334076860223.auth.us-east-2.amazoncognito.com/oauth2/idpresponse`
3. **Keys**: create a key with *Sign in with Apple* and download `AuthKey_XXXX.p8`. Note the Key ID. The Team ID is at the top right.

Then run `sh ~/ringo-apple-setup.sh TEAM_ID KEY_ID app.ringo.signin ~/Downloads/AuthKey_XXXX.p8`.

## 3. iOS: build, TestFlight, App Store

```sh
npx eas-cli build -p ios --profile production
```
EAS signs in with your Apple ID and creates the distribution certificate, provisioning profile and push key (APNs).

1. In App Store Connect, go to **Apps → + → New App**. Choose iOS, name Ringo, bundle ID `app.ringo.mobile` and SKU `ringo`. Copy the **Apple ID** number from App Information into `eas.json` → `submit.production.ios.ascAppId`.
2. Run `npx eas-cli submit -p ios --latest`. Then add yourself as an internal tester in TestFlight.
3. Fill in the listing:
   - **Category** Productivity. **Age rating** 4+.
   - **Privacy Policy URL** as above.
   - **App Privacy**: no tracking. Data linked to the user, used only for App Functionality: Name, Email, Phone, Physical address, Audio, Other user content (transcripts), Contacts, User ID, Device ID, Purchase history (plan).
   - **Screenshots**: 6.9" iPhone (1320×2868). The iPad isn't supported (`supportsTablet: false`).
   - **Review notes**: Ringo calls businesses the user picks, with an AI voice that says it's an AI. Give the reviewer a demo Google account with a verified test phone and a safe number to call (for example your own business line).
4. **Payments (guideline 3.1.1). Decide before you submit.** Ringo sells $9.99/month through Stripe in a browser, not through In-App Purchase. Apple may say this is a digital service and require IAP. The argument for Stripe is that Ringo makes real phone calls to real businesses, a person-to-person service (3.1.3(e)). Options:
   - Submit as-is with that argument in the review notes.
   - Hide the Subscribe button in the iOS app. People subscribe on the web, and the app never mentions it (the "reader"-style approach).
   - Add StoreKit IAP. This is the most work, and Apple takes 15–30%.

## 4. Android: build, internal testing, Play

```sh
npx eas-cli build -p android --profile production     # .aab; EAS creates and keeps the upload keystore
```

1. **Push (FCM v1)**:
   - In Firebase console, add a project and an Android app with package `app.ringo.mobile`.
   - Go to **Project settings → Service accounts → Generate new private key**.
   - Run `npx eas-cli credentials -p android`, then choose production → Google Service Account → *Push Notifications (FCM V1)*, and upload the JSON.
   - Build again after this; no `google-services.json` is needed for Expo push.
2. In Play Console, **Create app**: name Ringo, App, Free, then accept the declarations.
3. **Upload key for `eas submit`**:
   - In Google Cloud, create a service account in the project linked to Play and add a JSON key.
   - In Play Console → **Users and permissions**, invite that service account's email with *Release* permissions.
   - Save the key as `apps/mobile/google-play-service-account.json`. It's gitignored.
4. The **first upload must be manual**, because Play needs an app before the API works. Download the `.aab` from the EAS build page and upload it in **Testing → Internal testing → Create release**. After that, `npx eas-cli submit -p android --latest` sends builds to the internal track as drafts (`eas.json`).
5. Under **App content**:
   - **Privacy policy**: the URL above.
   - **App access**: give the same demo account and instructions as for Apple.
   - **Ads**: none.
   - **Content rating** (IARC questionnaire): Utility/Productivity, no objectionable content, gives Everyone.
   - **Target audience**: 18+.
   - **Data safety**: data is encrypted in transit and users can request deletion (in-app and web). Collected and not shared, for app functionality and account management:
     - Personal info: name, email, phone, address.
     - Audio: call recordings.
     - Messages: SMS replies.
     - Contacts.
     - App activity.
     - App info and performance.
     - Device IDs: push token.
     - Financial info: purchase history (via Stripe).

     Processors such as Retell, Twilio, Stripe and Google count as service providers, not "sharing".
   - **Account deletion**: give the web URL (`https://dhab8f4nxogwy.cloudfront.net`, then Settings → Delete my account) and describe what's deleted.
   - **Financial features**: none. **Government**: no. **Health**: no.
6. Fill in the **Store listing**:
   - Short description, up to 80 characters: *Your AI assistant that calls businesses for you and answers calls you miss.*
   - Full description.
   - Graphics: 512×512 icon (`assets/app-icon.png`, resized), 1024×500 feature graphic, at least 2 phone screenshots.
7. Testing, then production:
   - **Personal account:** promote from internal to closed testing with 12+ testers for 14 days, then apply for production.
   - **Organization account:** go straight to production.
   - Google Play Billing: Play's rules don't require it for services consumed outside the app. Real phone calls count, so Stripe is fine.

## Releasing updates

- **JS-only changes** (screens, copy): run `eas build` and `eas submit` again. Build numbers auto-increment. You can add EAS Update later for over-the-air fixes.
- **Bump `version`** in `app.json` for each store release (1.1.0, then 1.2.0, and so on).
- **API or web changes** ship separately, with `sh ~/ringo-dashboard-deploy.sh`. Keep the API backward-compatible, because old app versions stay installed.

## Before public launch

- Rotate the Retell, Twilio, Google and Stripe keys that were shared in chat. Restrict the Google key to the Places API.
- Register A2P 10DLC in Twilio so US carriers deliver Ringo's texts.
- Get a legal review of `privacy.html` and `terms.html`, of call recording (all-party-consent states), and of TCPA.
- Set up a custom domain (e.g. `ringo.app`) with `-c domainName=…`, then update the URLs above, `eas.json` and Cognito.
- Create a `prod` stack (`-c stage=prod`): Multi-AZ database, deletion protection, 14-day backups.
