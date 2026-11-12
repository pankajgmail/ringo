# Ringo

Ringo is an AI phone assistant. It makes calls for you (billing disputes, cancellations, bookings), asks you mid-call when a decision is needed, and answers calls forwarded from your phone.

| Path | What |
|---|---|
| `apps/mobile` | Expo app — iOS, Android and web from one codebase (Expo Router, TanStack Query) |
| `apps/api` | Fastify + Drizzle API, Retell webhooks and tools, pg-boss dialer queue |
| `packages/shared` | zod schemas, domain constants and live-event types shared by app and API |
| `retell/prompts.ts` | Agent prompts (outbound, booking, inbound) |
| `infra` | AWS CDK: VPC, ECS Fargate, RDS Postgres, Cognito, KMS, S3; secrets in SSM Parameter Store |
| `docs/` | Architecture, setup, and the original prototype + requirements |

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

See [docs/architecture.md](docs/architecture.md) for how a call flows end to end.
