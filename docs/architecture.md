# Architecture

Last updated Nov 24, 2026. Diagram: [architecture.svg](architecture.svg) / [architecture.png](architecture.png).

```
 Ringo app: iOS · Android · web (one Expo codebase, apps/mobile)
   │ HTTPS + Cognito ID token     ▲ WebSocket /v1/live     ▲ Expo push → APNs / FCM ("calls" channel)
   ▼                              │                        │
 CloudFront ── S3 (web app, privacy.html, terms.html)
   │  /v1/*  /retell/*  /health    (WAF: AWS managed rules, 3000 req / 5 min per IP)
   ▼
 ALB (CloudFront only) ── ECS Fargate, 1 ARM64 task: Fastify API + pg-boss dialer
   │              │                │               │                 │
 RDS Postgres 17  KMS data key     S3 recordings   SSM secrets       Cognito (Google + Apple)
   │
   ├── Retell AI ── SIP ── Twilio Elastic SIP trunk ── PSTN   (outbound + forwarded inbound calls)
   ├── Twilio Verify (phone codes) · Twilio Messaging (SMS / WhatsApp asks and replies)
   ├── Stripe (Checkout, Customer Portal, webhooks)
   └── Google (Places search, Calendar free/busy + events)
```

AWS account `334076860223`, region `us-east-2`, CDK stack `Ringo-<stage>` (`infra/lib/ringo-stack.ts`).

## Components

| Part | Where | Notes |
|---|---|---|
| App | `apps/mobile` | Expo SDK 58, expo-router (typed routes), TanStack Query. Screens: Out Call `(tabs)/index`, In Call `(tabs)/in`, call detail `call/[id]`, settings, forwarding, feedback, admin, sign-in. |
| API | `apps/api` | Fastify, Drizzle ORM, zod schemas from `packages/shared`. Migrations run on start. |
| Queue | `apps/api/src/jobs` | pg-boss in the same Postgres. `place-call` jobs carry priority, `startAfter` (scheduled calls) and a singleton key. |
| Agents | `retell/prompts.ts`, `apps/api/scripts/setup-retell.ts` | Three Retell agents on `gpt-5.4-mini`: outbound, booking, inbound. `npm run retell:setup` creates or updates them. |
| Infra | `infra` | VPC, RDS, ECS, ALB, CloudFront, WAF, Cognito, KMS, S3; secrets in SSM Parameter Store. |

### API modules

| Module | Job |
|---|---|
| `services/retell.ts` | Retell client, webhook signature check |
| `services/live.ts` | In-memory WebSocket hub and ask waiters; Expo push (`channelId: "calls"`) |
| `services/messaging.ts` | Twilio SMS/WhatsApp send, reply parsing, STOP/HELP/START keywords, message cleanup |
| `services/billing.ts` | Free-call allowance, Stripe Checkout and Portal, subscription webhooks |
| `services/calendar.ts` | Google OAuth connect, free/busy, add event, disconnect |
| `services/numbers.ts` | Buys and releases per-user Ringo numbers on the SIP trunk and imports them into Retell (cap `MAX_RINGO_NUMBERS`) |
| `lib/auth.ts` | Cognito JWT check; Google or Apple identity with a verified email |
| `lib/crypto.ts` | KMS envelope encryption (AES-256-GCM, AAD bound to user + field) |
| `lib/safety.ts` | `checkDialable`: US/CA only, no N11, 900/976 or 555-01xx |
| `lib/delete-account.ts` | Hard account deletion (see Security) |
| `lib/audit.ts`, `lib/tz.ts` | Audit log; time zones |

## HTTP surface

| Route | Purpose |
|---|---|
| `GET /health` | Load balancer check |
| `GET/PUT/DELETE /v1/me`, `PUT /v1/me/preferences` | Profile, preferences (ask mode, text mode, calendar), account deletion |
| `POST /v1/me/phone/verify`, `/v1/me/phone/check` | Twilio Verify SMS code |
| `POST /v1/me/number`, `PUT /v1/me/forwarding` | Personal Ringo number; call-forwarding state |
| `POST /v1/push-tokens` | Expo push token registration |
| `GET/POST /v1/calls`, `GET /v1/calls/:id`, `POST …/cancel`, `…/repeat`, `…/asks/:askId` | Out calls and answers to mid-call questions |
| `GET /v1/in-calls`, `POST /v1/in-calls/:id/callback` | Screened inbound calls; "Ringo calls back" |
| `GET /v1/savings`, `GET /v1/places` | Money saved; business search (Google Places + built-in brands) |
| `POST /v1/calendar/connect`, `GET /v1/calendar/callback`, `DELETE /v1/calendar` | Google Calendar link |
| `GET /v1/billing`, `POST /v1/billing/checkout`, `POST /v1/billing/portal` | Plan and payment |
| `POST /v1/feedback`, `GET /v1/admin/stats` | Star rating + comment; admin dashboard (`ADMIN_EMAILS`) |
| `GET /v1/live` (WebSocket) | Call stage, transcript lines, asks |
| `POST /v1/webhooks/twilio/message` | SMS/WhatsApp replies (Twilio signature checked) |
| `POST /v1/webhooks/stripe` | Subscription events (Stripe signature checked) |
| `POST /retell/webhook`, `/retell/inbound`, `/retell/tools/*` | Retell call events, inbound routing, mid-call tools (Retell signature checked) |

Tables: `users`, `out_calls`, `asks`, `in_calls`, `feedback`, `push_tokens`, `audit_log`, plus the `pgboss` schema.

## Outbound call

1. **Request.** `POST /v1/calls` validates the brief (`OutCallInputSchema`), runs `checkDialable`, requires a verified phone and checks billing (`assertCanCall`: 5 free calls, then $9.99/month). It stores the call in `out_calls` and enqueues a pg-boss job.
2. **Dial.** The dialer checks the per-user limit (2 at once) and the monthly budget. It picks the outbound or booking agent, then calls `retell.call.createPhoneCall` with dynamic variables and `metadata.outCallId`.
3. **Tools during the call:**
   - `report_status`: stage (menu, hold, talk) and a note, pushed live to the app.
   - `ask_user`: a decision (approve an offer), a texted code, or information Ringo never stores (account number, PIN).
     - The API writes an `asks` row, publishes it on the WebSocket and sends a push. With "Text me" on, it also sends an SMS or WhatsApp message.
     - Each tool request returns within 50 s, because the Retell tool timeout is 58 s and CloudFront cuts requests off at 60 s. With no answer yet, the agent gets `still_waiting` plus an `ask_id`. It keeps the rep engaged and calls `wait_for_answer`.
     - Wait limits: decisions 50 s (2 min by text); codes and info 2 min (`INFO_WAIT_MS`).
     - On timeout the agent agrees to nothing, asks for a reference number and ends the call.
   - `conference_user`: if the user picked "Conference me in", Retell warm-transfers to the user's phone (90 s ring) with a private briefing.
   - `check_calendar`: free/busy for a proposed time, when Google Calendar is connected.
   - `press_digit`, `end_call`.
4. **Webhooks after the call:**
   - `call_ended`: duration, hold, cost and transcript. Busy or no-answer calls are redialed up to 3 times, 10 min apart.
   - `call_analyzed`: outcome, summary, reference number, money saved and follow-up date. With "Save to calendar" on, a confirmed appointment is added to Google Calendar.

## Inbound call

1. The user gets a personal Ringo number (`POST /v1/me/number`). On the Forwarding screen they turn on conditional call forwarding with their carrier's codes. Calls they don't answer within about 5 rings go to Ringo.
2. `/retell/inbound` maps the dialed number to its user and returns dynamic variables.
3. The inbound agent greets the caller as the user's assistant:
   - It takes a message and a callback number.
   - Sales callers are asked what's in it for the user, the value, the price and any deadline.
   - Robocalls and scams are told the user isn't interested.
4. `call_analyzed` writes `in_calls`:
   - Type: `important`, `message`, `sales` or `spam`.
   - The summary, and the offer fields for sales calls.

   The user gets a push for everything but spam. "Ringo calls back" turns a message into an out call.

## Text replies (SMS / WhatsApp)

- **Senders:** questions go out from `TWILIO_SMS_FROM` (default: the Ringo number) or `TWILIO_WHATSAPP_FROM`, which is the Twilio sandbox until a WhatsApp Business sender is approved.
- **Replies:** they arrive at `/v1/webhooks/twilio/message`, are matched by phone number to the open ask, and are parsed:
  - 1/yes accepts.
  - 2/no declines and counters.
  - 3 or JOIN conferences the user in.
  - 4 hangs up.
  - Anything else is passed on as the answer.
- **Cleanup:** delivered texts are deleted from Twilio afterwards.
- **Carrier keywords (CTIA):**
  - STOP and its variants (including END and CANCEL) switch the user back to app-only questions and are audit-logged.
  - HELP returns support info.
  - START is acknowledged.
- **US SMS** needs A2P 10DLC registration.

## Billing

Stripe is on when `STRIPE_SECRET_KEY` is set. `-` means off, and calls are unlimited.

- **Subscribe:** Settings → Plan opens Stripe Checkout.
- **Manage:** "Manage subscription" opens the Customer Portal.
- **Webhooks:** `checkout.session.completed` and `customer.subscription.*` update the user's plan.
- **Account deletion** cancels the subscription.

## Mobile app (iOS / Android)

| Area | Detail |
|---|---|
| Builds | EAS profiles: `development` (dev client), `preview` (internal; APK on Android), `production` (App Store / Play; AAB). Build numbers auto-increment from remote app versions. `eas submit` uploads to App Store Connect and to the Play internal track as a draft. |
| Identity | `app.ringo.mobile` on both platforms, scheme `ringo`, version 1.1.0. |
| Icons | Opaque 1024 px store icon; Android adaptive icon (foreground, background, monochrome); white notification icon; splash on `#0b0f1a` via `expo-splash-screen`. |
| Push | Expo push → APNs / FCM. High-priority Android channel `calls`. Tapping a notification opens the call or In Call, including from a cold start. |
| Permissions | Contacts (to pick a business) and notifications. Android blocks microphone, camera, location, phone state and similar. iOS privacy manifest: no tracking. |
| Sign-in | Cognito hosted UI with PKCE in a private browser session. Google everywhere; Apple on iOS when `EXPO_PUBLIC_APPLE_SIGN_IN=true` (guideline 4.8). Tokens are stored in the Keychain/Keystore, this device only. |
| Store rules | In-app account deletion. Settings has Privacy, Terms, Help & support and an auto-renew disclosure. Star-rating feedback opens the system review prompt for 4–5 stars. |

## Security

- **Encryption:** KMS at rest (database, recordings, secrets) and TLS in transit. Account numbers and PINs are never stored; the agent asks for them mid-call.
- **Sign-in:** the API accepts only Google or Apple identities with a verified email. `AUTH_DEV_BYPASS` is rejected in production.
- **Webhooks:** Retell, Twilio and Stripe webhooks are all signature-checked.
- **Rate limits:** set per route (calls 20/h, phone codes 5/h, search 120/min, feedback 10/h).
- **Responses:** CORS is limited to Ringo's own origins, and responses are `no-store`.
- **Calls:** Ringo says it's an AI and that the call may be recorded. Emergency and premium numbers are blocked.
- **Account deletion is a hard delete.** It:
  - deletes every row for the user;
  - deletes Retell recordings and transcripts;
  - releases the Ringo number;
  - disconnects Google Calendar;
  - cancels Stripe;
  - removes the Cognito user.

## Known limits / next steps

- **Single API task.** `services/live.ts` keeps WebSocket clients and ask waiters in memory, so `desiredCount` stays 1. To scale out, fan events through Postgres `LISTEN/NOTIFY` and resolve asks from the DB, where they already live.
- **Messaging:** A2P 10DLC for US SMS; an approved WhatsApp Business sender.
- **Caller reputation:** Twilio Trust Hub / SHAKEN-STIR and CNAM.
- **Production stage:** a custom domain (`-c domainName=`) and a `prod` stage with Multi-AZ RDS, deletion protection and longer backups.
- **App Store guideline 3.1.1:** the subscription is sold through Stripe, not In-App Purchase. Ringo's calls are a real-world service, which supports this, but Apple may disagree. See [store-launch.md](store-launch.md).
