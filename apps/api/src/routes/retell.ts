import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { IN_CALL_TYPES, OUTCOMES, STAGES, type InCallType, type Outcome, type Stage, type TranscriptLine } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { decrypt } from "../lib/crypto.ts";
import { audit } from "../lib/audit.ts";
import { finish, maybeRedial } from "../jobs/dialer.ts";
import { verifyRetell } from "../services/retell.ts";
import { isOnline, publish, push } from "../services/live.ts";
import { toOutCall } from "../services/serialize.ts";

// Retell → Ringo. Every request is signed (x-retell-signature) over the raw body.
//   POST /retell/webhook   call lifecycle events
//   POST /retell/inbound   inbound-call routing (which user does this forwarded call belong to?)
//   POST /retell/tools/*   custom tools the agent calls mid-conversation

type RetellCall = {
  call_id: string;
  direction?: "inbound" | "outbound";
  from_number?: string;
  to_number?: string;
  metadata?: { outCallId?: string; userId?: string } | null;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  transcript_object?: { role: "agent" | "user" | "transfer_target"; content: string; words?: { start?: number }[] }[];
  call_analysis?: { call_summary?: string; custom_analysis_data?: Record<string, unknown> };
  call_cost?: { combined_cost?: number };
  retell_llm_dynamic_variables?: Record<string, string>;
};

const ASK_TIMEOUT_MS = 90_000; // tool timeout in the agent config must be larger (120s)

async function verified(req: FastifyRequest) {
  return verifyRetell((req as FastifyRequest & { rawBody: string }).rawBody, req.headers["x-retell-signature"] as string | undefined);
}

/** Retell "user" is whoever the agent is talking to: the rep on outbound, the caller on inbound. */
const toLines = (t: RetellCall["transcript_object"] = []): TranscriptLine[] =>
  t.map((u) => ({ role: u.role === "agent" ? "agent" : "other", text: u.content, at: u.words?.[0]?.start }));

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

async function outCallFor(call: RetellCall) {
  const id = call.metadata?.outCallId;
  const [row] = id
    ? await db.select().from(schema.outCalls).where(eq(schema.outCalls.id, id))
    : await db.select().from(schema.outCalls).where(eq(schema.outCalls.retellCallId, call.call_id));
  return row;
}

async function userByRingoNumber(n: string | undefined) {
  if (!n) return undefined;
  const [u] = await db.select().from(schema.users).where(eq(schema.users.ringoNumber, n));
  return u && !u.deletedAt ? u : undefined;
}

export async function retellRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req, reply) => {
    if (!(await verified(req))) return reply.code(401).send({ error: "bad signature" });
  });

  app.post("/retell/webhook", async (req, reply) => {
    const { event, call } = req.body as { event: string; call: RetellCall };
    if (call.direction === "inbound") {
      await handleInbound(event, call);
      return reply.code(204).send();
    }
    const row = await outCallFor(call);
    if (!row) return reply.code(204).send();

    if (event === "call_started") {
      const [u] = await db.update(schema.outCalls).set({ status: "in_progress", startedAt: new Date(), retellCallId: call.call_id }).where(eq(schema.outCalls.id, row.id)).returning();
      if (u) publish(row.userId, { type: "call.updated", call: toOutCall(u) });
    } else if (event === "transcript_updated") {
      const lines = toLines(call.transcript_object);
      const last = lines.at(-1);
      await db.update(schema.outCalls).set({ transcript: lines }).where(eq(schema.outCalls.id, row.id));
      if (last) publish(row.userId, { type: "call.transcript", callId: row.id, line: last });
    } else if (event === "call_ended") {
      const holdSec = (row.holdSec ?? 0) + (row.holdStartedAt ? Math.round((Date.now() - row.holdStartedAt.getTime()) / 1000) : 0);
      await db.update(schema.outCalls).set({
        transcript: toLines(call.transcript_object),
        durationSec: call.duration_ms ? Math.round(call.duration_ms / 1000) : null,
        holdSec, holdStartedAt: null,
        disconnectionReason: call.disconnection_reason ?? null,
        costCents: call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost) : null,
      }).where(eq(schema.outCalls.id, row.id));
      if (row.status === "cancelled") return reply.code(204).send();
      if (await maybeRedial(row, call.disconnection_reason)) {
        publish(row.userId, { type: "call.stage", callId: row.id, stage: "queue", line: "Line was busy. Ringo will try again in 10 minutes." });
      }
      // Final outcome arrives with call_analyzed.
    } else if (event === "call_analyzed") {
      if (row.status === "cancelled" || row.status === "queued") return reply.code(204).send();
      const data = call.call_analysis?.custom_analysis_data ?? {};
      const outcome: Outcome = pick(data.outcome, OUTCOMES, "failed");
      await finish(row.id, row.userId, {
        status: outcome === "failed" ? "failed" : "completed",
        outcome,
        summary: String(data.result_summary ?? call.call_analysis?.call_summary ?? "Call ended."),
        reference: data.reference_number ? String(data.reference_number) : null,
        costCents: call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost) : row.costCents,
      });
    }
    return reply.code(204).send();
  });

  /** Inbound routing: a forwarded call hit a Ringo number. Choose the user and inject their context. */
  app.post("/retell/inbound", async (req) => {
    const { call_inbound } = req.body as { call_inbound: { from_number: string; to_number: string } };
    const user = await userByRingoNumber(call_inbound.to_number);
    if (!user) return { call_inbound: {} }; // unassigned number: the phone number's default agent handles it
    return {
      call_inbound: {
        dynamic_variables: { user_name: user.name || "the person you called", caller_number: call_inbound.from_number },
        metadata: { userId: user.id },
      },
    };
  });

  // ---------- Custom tools (agent → backend, mid-call) ----------

  /** Agent reports where it is: menu / hold / talk. Drives the live tracker and hold timer. */
  app.post("/retell/tools/report_status", async (req) => {
    const { call, args } = req.body as { call: RetellCall; args: { stage: string; note?: string } };
    const row = await outCallFor(call);
    if (!row) return { ok: false };
    const stage: Stage = pick(args.stage, STAGES, row.stage);
    const now = Date.now();
    const closedHold = row.holdStartedAt && stage !== "hold" ? Math.round((now - row.holdStartedAt.getTime()) / 1000) : 0;
    await db.update(schema.outCalls).set({
      stage,
      holdSec: (row.holdSec ?? 0) + closedHold,
      holdStartedAt: stage === "hold" ? (row.holdStartedAt ?? new Date(now)) : null,
    }).where(eq(schema.outCalls.id, row.id));
    publish(row.userId, { type: "call.stage", callId: row.id, stage, line: args.note ?? "" });
    if (stage === "talk" && row.stage === "hold") await push(row.userId, `${row.name} picked up`, "Ringo is talking to a person now.", { outCallId: row.id });
    return { ok: true };
  });

  /**
   * Agent needs the account details it was not given up front. Only returns the account
   * for the provider being called, and logs every access.
   */
  app.post("/retell/tools/get_account", async (req) => {
    const { call } = req.body as { call: RetellCall };
    const row = await outCallFor(call);
    if (!row) return { found: false };
    const [acct] = await db.select().from(schema.accounts).where(and(eq(schema.accounts.userId, row.userId), eq(schema.accounts.providerId, row.providerId)));
    if (!acct) return { found: false, message: "No saved account. Ask the rep to look the account up by phone number, or use ask_user." };
    await audit(row.userId, "account.read_by_agent", { outCallId: row.id, providerId: row.providerId });
    return {
      found: true,
      account_number: await decrypt(acct.accountNumberEnc, { userId: row.userId, field: "account" }),
      holder_name: acct.holderName ?? "",
      pin: acct.pinEnc ? await decrypt(acct.pinEnc, { userId: row.userId, field: "pin" }) : "",
    };
  });

  /**
   * Ask the user something mid-call (an offer to approve, or an OTP the provider texted them).
   * Pushes to the app and long-polls for the answer. The agent keeps the rep engaged meanwhile.
   */
  app.post("/retell/tools/ask_user", async (req) => {
    const { call, args } = req.body as { call: RetellCall; args: { question: string; kind?: "decision" | "code" } };
    const row = await outCallFor(call);
    if (!row) return { answered: false, instruction: "Tell the rep you'll call back, then end the call." };
    const kind = args.kind === "code" ? "code" : "decision";

    if (kind === "decision" && row.askMe !== "ask") {
      return row.askMe === "decline"
        ? { answered: true, choice: "counter", instruction: "Politely decline and ask again for what the goal says." }
        : { answered: true, choice: "end", instruction: "Thank the rep, note the offer, and end the call." };
    }

    const expiresAt = new Date(Date.now() + ASK_TIMEOUT_MS);
    const [ask] = await db.insert(schema.asks).values({ outCallId: row.id, kind, question: args.question, expiresAt }).returning();
    const [u] = await db.update(schema.outCalls).set({ status: "awaiting_user" }).where(eq(schema.outCalls.id, row.id)).returning();
    if (u) publish(row.userId, { type: "call.updated", call: toOutCall(u) });
    publish(row.userId, {
      type: "call.ask", callId: row.id, askId: ask!.id, kind, question: args.question,
      options: kind === "code" ? ["reply"] : ["accept", "counter", "takeover", "end"], expiresAt: expiresAt.toISOString(),
    });
    if (!isOnline(row.userId) || kind === "code") {
      await push(row.userId, kind === "code" ? `${row.name} needs a code` : `${row.name}: decision needed`, args.question, { outCallId: row.id, askId: ask!.id });
    }

    const answered = await waitForAnswer(ask!.id, expiresAt);
    await db.update(schema.outCalls).set({ status: "in_progress" }).where(and(eq(schema.outCalls.id, row.id), eq(schema.outCalls.status, "awaiting_user")));
    if (!answered) {
      await db.update(schema.asks).set({ answeredAt: new Date(), answer: "timeout" }).where(and(eq(schema.asks.id, ask!.id), isNull(schema.asks.answeredAt)));
      publish(row.userId, { type: "call.ask_resolved", callId: row.id, askId: ask!.id });
      return { answered: false, instruction: "The account holder didn't respond. Don't accept anything. Ask for a reference number and say they'll call back." };
    }
    const instructions: Record<string, string> = {
      accept: "The account holder accepts. Confirm the details and ask for a reference number.",
      counter: "The account holder declines. Ask politely for a better outcome, or for a supervisor.",
      takeover: "The account holder will join the call. Tell the rep to please hold for a moment.",
      end: "Thank the rep and end the call.",
      reply: `The account holder replied: "${answered.note ?? ""}". Use it to answer the rep.`,
    };
    return { answered: true, choice: answered.answer, note: answered.note ?? "", instruction: instructions[answered.answer ?? "end"] };
  });
}

async function waitForAnswer(askId: string, until: Date) {
  while (Date.now() < until.getTime()) {
    const [a] = await db.select().from(schema.asks).where(eq(schema.asks.id, askId));
    if (a?.answeredAt) return a;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function handleInbound(event: string, call: RetellCall) {
  const user = call.metadata?.userId
    ? (await db.select().from(schema.users).where(eq(schema.users.id, call.metadata.userId)))[0]
    : await userByRingoNumber(call.to_number);
  if (!user || event !== "call_analyzed") return;
  const data = call.call_analysis?.custom_analysis_data ?? {};
  const type: InCallType = pick(data.caller_type, IN_CALL_TYPES, "message");
  const [row] = await db.insert(schema.inCalls).values({
    userId: user.id,
    retellCallId: call.call_id,
    fromNumber: call.from_number ?? "",
    callerName: data.caller_name ? String(data.caller_name) : null,
    type,
    summary: String(data.message ?? call.call_analysis?.call_summary ?? ""),
    callbackNumber: data.callback_number ? String(data.callback_number) : null,
    transcript: toLines(call.transcript_object),
    startedAt: call.start_timestamp ? new Date(call.start_timestamp) : new Date(),
    durationSec: call.duration_ms ? Math.round(call.duration_ms / 1000) : null,
    costCents: call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost) : null,
  }).onConflictDoNothing().returning();
  if (row && type !== "spam") {
    await push(user.id, type === "important" ? `Important: ${row.callerName ?? row.fromNumber}` : `Message from ${row.callerName ?? row.fromNumber}`, row.summary ?? "", { inCallId: row.id });
  }
}
