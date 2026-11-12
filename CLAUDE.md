# Ringo — project instructions

These override any parent-folder "single HTML file / no server" rules: Ringo is a full-stack monorepo (Expo app, Fastify API, AWS CDK).

- TypeScript everywhere, strict. Shared contracts live in `packages/shared` — change the zod schema there, not in two places.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `npm run db:generate`. Never hand-edit generated migrations.
- Agent behavior lives in `retell/prompts.ts` + `apps/api/scripts/setup-retell.ts`; re-run `npm run retell:setup` after changes.
- Secrets never go in code or `app.json`; on AWS they are SecureString parameters under `/ringo/<stage>/` (see docs/setup.md). Sensitive user fields go through `lib/crypto.ts` and are audit-logged on read.
- npm enforces `min-release-age=3`: pin dependency versions that are at least a few days old.
- Verify with `npm run typecheck && npm test` before committing.
