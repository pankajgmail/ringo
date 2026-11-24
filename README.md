# Ringo

Ringo is an AI phone assistant for iOS, Android and the web.

- **Out Call:** Ringo calls businesses for you: billing disputes, cancellations, bookings. When it needs a decision, a code or an account detail mid-call, it asks you by push, SMS or WhatsApp, or conferences you in. Confirmed appointments go on your Google Calendar.
- **In Call:** your own Ringo number answers calls you miss. It takes messages, asks sales callers about the value, price and deadline, and blocks spam.
- **Plan:** 5 free calls, then $9.99/month (Stripe). The app also has in-app feedback and an admin dashboard.

| Path | What |
|---|---|
| `apps/mobile` | Expo app — iOS, Android and web from one codebase (Expo Router, TanStack Query) |
| `apps/api` | Fastify + Drizzle API, Retell webhooks and tools, pg-boss dialer queue |
| `packages/shared` | zod schemas, domain constants and live-event types shared by app and API |
| `retell/prompts.ts` | Agent prompts (outbound, booking, inbound) |
| `infra` | AWS CDK: VPC, ECS Fargate, RDS Postgres, CloudFront + WAF, Cognito (Google + Apple), KMS, S3; secrets in SSM Parameter Store |
| `docs/` | [Architecture](docs/architecture.md), [setup](docs/setup.md), [App Store + Google Play launch](docs/store-launch.md), and the original prototype + requirements |

## Quick start (local)

```sh
npm install
docker run -d --name ringo-pg -e POSTGRES_USER=ringo -e POSTGRES_PASSWORD=ringo -p 5432:5432 postgres:17
cp apps/api/.env.example apps/api/.env      # set DEV_ENCRYPTION_KEY=$(openssl rand -base64 32)
npm run db:migrate
npm run dev:api                              # http://localhost:8080
npm run dev:app                              # press w for web, or scan with Expo Go
```

With `AUTH_DEV_BYPASS=true` and no Cognito config the app signs in as a dev user. Real calls need Retell + Twilio — see [docs/setup.md](docs/setup.md).

## Checks

```sh
npm run typecheck
npm test
```

## Mobile builds

```sh
cd apps/mobile
npx eas-cli build -p all --profile production   # iOS .ipa + Android .aab
npx eas-cli submit -p all --latest              # TestFlight + Play internal track
```

See [docs/store-launch.md](docs/store-launch.md) for the store setup, and [docs/architecture.md](docs/architecture.md) for how a call flows end to end.
