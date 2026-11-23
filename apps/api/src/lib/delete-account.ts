import { AdminDeleteUserCommand, CognitoIdentityProviderClient, ListUsersCommand, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { retell, retellConfigured } from "../services/retell.ts";
import { boss, QUEUE } from "../jobs/queue.ts";
import type { User } from "./auth.ts";
import { audit } from "./audit.ts";

const cognito = env.COGNITO_USER_POOL_ID ? new CognitoIdentityProviderClient({}) : null;
const LIVE = ["dialing", "in_progress", "awaiting_user"] as const;

/**
 * Deletes everything Ringo holds about a user (App Store 5.1.1(v), CCPA/GDPR erasure):
 * live calls are hung up, Retell's copies (recordings, transcripts) are deleted, then the user row,
 * which cascades to calls, messages, questions and push tokens. Last, the Cognito sign-in is removed
 * so the same Google account starts fresh next time. The audit row keeps no personal data.
 */
export async function deleteAccount(user: User) {
  const out = await db.select({ id: schema.outCalls.id, jobId: schema.outCalls.jobId, retellCallId: schema.outCalls.retellCallId, status: schema.outCalls.status })
    .from(schema.outCalls).where(eq(schema.outCalls.userId, user.id));
  const inbound = await db.select({ retellCallId: schema.inCalls.retellCallId }).from(schema.inCalls).where(eq(schema.inCalls.userId, user.id));

  if (retellConfigured) {
    for (const c of out) if (c.retellCallId && (LIVE as readonly string[]).includes(c.status)) await retell.call.stop(c.retellCallId).catch(() => undefined);
    const ids = [...out, ...inbound].map((c) => c.retellCallId).filter((x): x is string => !!x);
    for (const id of ids) await retell.call.delete(id).catch(() => undefined);
  }

  // Queued jobs would be no-ops anyway (placeCall skips missing rows); cancel them so nothing dials.
  const jobs = out.map((c) => c.jobId).filter((x): x is string => !!x);
  if (jobs.length) await boss.cancel(QUEUE.placeCall, jobs).catch(() => undefined);

  await db.transaction(async (tx) => {
    await tx.update(schema.auditLog).set({ detail: null }).where(eq(schema.auditLog.userId, user.id));
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  });
  await audit(null, "user.deleted", { calls: out.length + inbound.length });

  if (cognito && !user.authSub.startsWith("dev:")) {
    // Google users have a Cognito username like "google_1234…", not their sub, so look it up.
    const found = await cognito.send(new ListUsersCommand({ UserPoolId: env.COGNITO_USER_POOL_ID, Filter: `sub = "${user.authSub.replace(/"/g, "")}"`, Limit: 1 }));
    const username = found.Users?.[0]?.Username;
    if (username) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: env.COGNITO_USER_POOL_ID, Username: username }))
        .catch((e) => { if (!(e instanceof UserNotFoundException)) throw e; });
    }
  }
}
