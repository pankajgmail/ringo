import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { PRIORITY_QUEUE, PROVIDERS } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { retell, retellConfigured } from "../services/retell.ts";
import { publish, push } from "../services/live.ts";
import { toOutCall } from "../services/serialize.ts";
import { boss, enqueueCall, QUEUE, type PlaceCallJob } from "./queue.ts";

const LIVE: (typeof schema.outCalls.$inferSelect.status)[] = ["dialing", "in_progress", "awaiting_user"];
const MAX_DIAL_ATTEMPTS = 3;

/** Thrown to make pg-boss retry later (e.g. user already has max concurrent calls). */
class Defer extends Error {}

export async function startDialer() {
  await boss.work<PlaceCallJob>(QUEUE.placeCall, { batchSize: 1 }, async ([job]) => {
    if (job) await placeCall(job.data.outCallId);
  });
}

export async function placeCall(outCallId: string) {
  const [call] = await db.select().from(schema.outCalls).where(eq(schema.outCalls.id, outCallId));
  if (!call || !["scheduled", "queued"].includes(call.status)) return; // cancelled or already handled
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, call.userId));
  if (!user || user.deletedAt) return;

  const [{ live } = { live: 0 }] = await db
    .select({ live: sql<number>`count(*)::int` })
    .from(schema.outCalls)
    .where(and(eq(schema.outCalls.userId, user.id), inArray(schema.outCalls.status, LIVE)));
  if (live >= env.MAX_CONCURRENT_CALLS_PER_USER) throw new Defer("concurrency limit");

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [{ spent } = { spent: 0 }] = await db
    .select({ spent: sql<number>`coalesce(sum(${schema.outCalls.costCents}), 0)::int` })
    .from(schema.outCalls)
    .where(and(eq(schema.outCalls.userId, user.id), gte(schema.outCalls.createdAt, monthStart)));
  if (spent >= user.monthlyBudgetCents) {
    return finish(call.id, user.id, { status: "failed", outcome: "failed", summary: "Monthly call budget reached. Raise it in Settings to keep calling." });
  }

  const from = user.ringoNumber ?? env.DEFAULT_FROM_NUMBER;
  if (!from) return finish(call.id, user.id, { status: "failed", outcome: "failed", summary: "No Ringo number is assigned to your account yet." });

  const isBooking = call.category === "reservation";
  const agentId = isBooking ? env.RETELL_BOOKING_AGENT_ID : env.RETELL_OUTBOUND_AGENT_ID;
  if (!retellConfigured || !agentId) return finish(call.id, user.id, { status: "failed", outcome: "failed", summary: "Calling isn't set up yet. Please try again later." });
  const r = call.reservation;
  const attempt = call.attempts + 1;

  await db.update(schema.outCalls).set({ status: "dialing", stage: "dial", attempts: attempt }).where(eq(schema.outCalls.id, call.id));
  try {
    const res = await retell.call.createPhoneCall({
      from_number: from,
      to_number: call.number,
      override_agent_id: agentId,
      idempotency_key: `${call.id}:${attempt}`,
      metadata: { outCallId: call.id, userId: user.id },
      retell_llm_dynamic_variables: {
        user_name: user.name || "the account holder",
        user_phone: user.phone ?? "",
        user_address: user.address,
        provider_name: call.name || PROVIDERS.find((p) => p.id === call.providerId)?.name || "",
        goal: call.goal,
        limits: call.limits || "None given. Ask the user before agreeing to anything not in the goal.",
        ask_me: call.askMe,
        booking_date: r?.date ?? "",
        booking_time: r?.time ?? "",
        party_size: r ? String(r.party) : "",
      },
    });
    const [row] = await db.update(schema.outCalls).set({ retellCallId: res.call_id }).where(eq(schema.outCalls.id, call.id)).returning();
    if (row) publish(user.id, { type: "call.updated", call: toOutCall(row) });
    await audit(user.id, "call.placed", { outCallId: call.id, to: call.number, attempt });
  } catch (err) {
    await db.update(schema.outCalls).set({ status: "queued", stage: "queue" }).where(eq(schema.outCalls.id, call.id));
    throw err; // pg-boss retries with backoff
  }
}

/** Called from the call_ended webhook when the call never reached anyone. */
export async function maybeRedial(call: typeof schema.outCalls.$inferSelect, reason: string | undefined) {
  const retryable = ["dial_busy", "dial_no_answer", "dial_failed", "telephony_provider_unavailable"].includes(reason ?? "");
  if (!retryable || call.attempts >= MAX_DIAL_ATTEMPTS) return false;
  const at = new Date(Date.now() + 10 * 60_000);
  await db.update(schema.outCalls).set({ status: "queued", stage: "queue", retellCallId: null, scheduledAt: at }).where(eq(schema.outCalls.id, call.id));
  await enqueueCall(call.id, at, PRIORITY_QUEUE[call.priority]);
  return true;
}

export async function finish(
  outCallId: string,
  userId: string,
  patch: Partial<typeof schema.outCalls.$inferInsert> & Pick<typeof schema.outCalls.$inferInsert, "status" | "outcome" | "summary">,
) {
  const [row] = await db.update(schema.outCalls).set({ stage: "done", endedAt: new Date(), ...patch }).where(eq(schema.outCalls.id, outCallId)).returning();
  if (!row) return;
  publish(userId, { type: "call.updated", call: toOutCall(row) });
  await push(userId, row.outcome === "success" ? `Done: ${row.name}` : `Call finished: ${row.name}`, row.summary ?? "", { outCallId });
}
