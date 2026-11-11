# Architecture

```
 Expo app (iOS / Android / web)
   │  HTTPS (Cognito ID token)        WebSocket /v1/live        Expo push
   ▼                                        ▲                       ▲
 ┌──────────────────── API (Fastify, ECS Fargate) ─────────────────────┐
 │ /v1/*  user routes      /retell/*  webhook + tools   pg-boss dialer │
 └───────┬──────────────────────────────┬──────────────────────────────┘
         │                              │ createPhoneCall / webhooks / tool calls
   RDS Postgres 17                   Retell AI ── SIP ── Twilio Elastic SIP trunk ── PSTN
   (app data + pgboss schema)
```

## Outbound call

1. `POST /v1/calls` validates the brief (`OutCallInputSchema`), runs `checkDialable` (US/CA only, no N11/900/976/555-01xx), requires a verified phone, stores `out_calls`, and enqueues a pg-boss job (`priority` from `PRIORITY_QUEUE`, `startAfter` = scheduled time, `singletonKey` = call id).
2. The dialer (`jobs/dialer.ts`) checks the per-user concurrency limit and monthly budget, chooses the outbound or booking agent, and calls `retell.call.createPhoneCall` with dynamic variables and `metadata.outCallId`.
3. During the call, Retell calls the tools:
   - `report_status` — stage (menu, hold, agent, verifying, negotiating, wrapping) and hold time, pushed live to the app.
   - `get_account` — decrypts the account number / PIN for this provider; every read is audit-logged.
   - `ask_user` — creates an `asks` row, pushes a notification, and long-polls up to 90 s for the user's answer (`POST /v1/calls/:id/asks/:askId`). Times out to a safe default. The Retell tool timeout is 120 s, ALB idle timeout 300 s.
4. Webhooks (`/retell/webhook`, signature verified with `Retell.verify`):
   - `call_ended` — duration, hold, cost, transcript; redials busy / no-answer up to 3 times, 10 min apart.
   - `call_analyzed` — outcome, summary, reference number from `post_call_analysis_data`.

## Inbound call

The user sets conditional call forwarding (`forwardingCodes`) to their `ringoNumber`. Retell hits `/retell/inbound`, which matches the number to a user and returns dynamic variables. The inbound agent screens the call. On `call_analyzed` an `in_calls` row is written, and the user gets a push unless the caller was classified as spam.

## Data and security

- Account numbers and PINs are KMS envelope-encrypted (AES-256-GCM, AAD bound to `{userId, field}`); only the last 4 digits are stored in clear.
- **Google sign-in only.** The app opens Cognito with `identity_provider=Google` (PKCE), so the user goes straight to Google. The pool has self sign-up disabled and no password users. The API verifies Cognito ID tokens with `aws-jwt-verify` and also requires a `Google` identity and `email_verified`. Every route except `/health` and the signature-checked `/retell/*` routes requires this. `AUTH_DEV_BYPASS` is rejected in production by `env.ts`.
- RDS enforces SSL; Retell stores `everything_except_pii`.
- Account deletion is soft (`deletedAt`). A nightly purge job is still TODO.

## Known limits / next steps

- **Single API task.** `services/live.ts` holds WebSocket clients and pending `ask_user` waits in memory, so `desiredCount` must stay 1. To scale out, fan events through Postgres `LISTEN/NOTIFY` (or Redis) and resolve asks from the DB.
- Per-user Twilio number provisioning (today: `DEFAULT_FROM_NUMBER`, numbers imported with `retell:setup --import`).
- Recording upload to the S3 bucket, Stripe billing, EAS build profiles, Twilio Trust Hub / STIR-SHAKEN registration.
