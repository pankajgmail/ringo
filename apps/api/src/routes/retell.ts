import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { INFO_WAIT_MS, IN_CALL_TYPES, TEXT_MODES, type TextMode, OUTCOMES, STAGES, type InCallType, type Outcome, type Stage, type TranscriptLine } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { audit } from "../lib/audit.ts";
import { finish, maybeRedial } from "../jobs/dialer.ts";
import { retell, verifyRetell } from "../services/retell.ts";
import { addEvent, busy } from "../services/calendar.ts";
import { fmtDay, fmtTime, parseLocal, today, zoned } from "../lib/tz.ts";
import { isOnline, publish, push } from "../services/live.ts";
import { forgetMessages, questionText, sendText, textConfigured } from "../services/messaging.ts";
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

// Retell reaches the API over HTTPS through CloudFront, which ends requests after 60s, so answer before that.
const ASK_TIMEOUT_MS = 50_000; // tool timeout in the agent config is 58s
/** After the 2-minute info wait runs out, how long the agent gets to wrap up before Ringo hangs up itself. */
const END_GRACE_MS = 20_000;

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
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, row.userId));
      const tz = user?.timezone || "America/Los_Angeles";
      const extra = callFacts(row, data, outcome, tz);
      await finish(row.id, row.userId, {
        status: outcome === "failed" ? "failed" : "completed",
        outcome,
        summary: String(data.result_summary || call.call_analysis?.call_summary || "Call ended."),
        reference: data.reference_number ? String(data.reference_number) : null,
        costCents: call.call_cost?.combined_cost != null ? Math.round(call.call_cost.combined_cost) : row.costCents,
        ...extra,
      });
      if (user && extra.appointmentAt) await saveToCalendar(user, { ...row, ...extra, reference: data.reference_number ? String(data.reference_number) : null, summary: String(data.result_summary || "") }, tz);
      if (extra.followUpAt) {
        await push(row.userId, `Follow up with ${row.name}?`, `They said to call back ${fmtDay(extra.followUpAt, tz)}. Tap to have Ringo do it.`, { outCallId: row.id });
      }
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
    const personNow = stage === "talk" && row.stage !== "talk";
    if (personNow && row.holdForMe) {
      await push(row.userId, `${row.name}: a person is on the line`, "Ringo is calling you now to connect you. Pick up!", { outCallId: row.id });
      publish(row.userId, { type: "call.stage", callId: row.id, stage, line: "A person answered. Calling you to connect…" });
      return {
        ok: true,
        instruction: `Hold for me is on: the account holder wants to talk to the rep themselves. Say: "Hi, thanks for picking up. I'm Ringo, an AI assistant for {{user_name}}. They'd like to speak with you directly, I'm connecting them now, one moment," then call conference_user. If they don't pick up, carry on with the goal yourself.`,
      };
    }
    if (personNow && row.stage === "hold") await push(row.userId, `${row.name} picked up`, "Ringo is talking to a person now.", { outCallId: row.id });
    return { ok: true };
  });

  /**
   * Calendar check: is the user free at a proposed time? Returns busy times only (never event titles), in the user's
   * time zone. Off unless they connected Google Calendar and left "Check my availability" on.
   */
  app.post("/retell/tools/check_calendar", async (req) => {
    const { call, args } = req.body as { call: RetellCall; args: { date?: string; time?: string; minutes?: number } };
    const row = await outCallFor(call);
    const [user] = row ? await db.select().from(schema.users).where(eq(schema.users.id, row.userId)) : [];
    if (!user?.googleRefreshToken || !user.calendarCheck) {
      return { available: "unknown", instruction: "You can't see the account holder's calendar. Use the times in the goal and limits; if a new time is proposed, call ask_user." };
    }
    const tz = user.timezone || "America/Los_Angeles";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "") ? args.date! : today(tz).iso;
    try {
      const dayStart = zoned(date, "00:00", tz);
      const busyTimes = await busy(user, dayStart, new Date(dayStart.getTime() + 864e5));
      const slots = busyTimes.map((b) => `${fmtTime(b.start, tz)}–${fmtTime(b.end, tz)}`);
      const base = { date, busy: slots.length ? slots : ["nothing booked"], time_zone: tz };
      if (!args.time || !/^\d{1,2}:\d{2}$/.test(args.time)) return { ...base, instruction: "Pick a time that doesn't overlap the busy times." };
      const start = zoned(date, args.time.padStart(5, "0"), tz);
      const end = new Date(start.getTime() + Math.max(15, Math.min(480, Number(args.minutes) || 60)) * 60_000);
      const clash = busyTimes.find((b) => b.start < end && b.end > start);
      return clash
        ? { ...base, available: false, instruction: `They're busy then (${fmtTime(clash.start, tz)}–${fmtTime(clash.end, tz)}). Ask for a time outside the busy times.` }
        : { ...base, available: true, instruction: "They're free then. It's fine to accept if it fits the goal and limits." };
    } catch {
      return { available: "unknown", instruction: "The calendar couldn't be checked right now. Use the goal and limits; call ask_user for anything new." };
    }
  });

  /**
   * Ask the user something mid-call: an offer to approve, a one-time code they were texted, or information Ringo
   * doesn't keep (account number, PIN, party size). Pushes to the app and long-polls for the answer.
   * Each request must finish inside CloudFront's 60s, so a 2-minute wait is split: if there's no answer after ~50s
   * the agent is told to keep the rep engaged and call wait_for_answer.
   */
  app.post("/retell/tools/ask_user", async (req) => {
    const { call, args } = req.body as { call: RetellCall; args: { question: string; kind?: string } };
    const row = await outCallFor(call);
    if (!row) return { answered: false, instruction: "Tell the rep you'll call back, then end the call." };
    const kind = args.kind === "code" || args.kind === "info" ? args.kind : "decision";

    if (kind === "decision" && row.askMe !== "ask") {
      return row.askMe === "decline"
        ? { answered: true, choice: "counter", instruction: "Politely decline and ask again for what the goal says." }
        : { answered: true, choice: "end", instruction: "Thank the rep, note the offer, and end the call." };
    }

    // Information only the user has: if they chose "conference me in", connect them instead of asking in the app.
    // Texted one-time codes are never conferenced; they're quicker to type than to read out.
    const [user] = await db.select({ infoMode: schema.users.infoMode, phone: schema.users.phone, verified: schema.users.phoneVerifiedAt }).from(schema.users).where(eq(schema.users.id, row.userId));
    if (kind === "info") {
      if (user?.infoMode === "conference" && user.phone) {
        await db.insert(schema.asks).values({ outCallId: row.id, kind, question: args.question, via: "conference", expiresAt: new Date(Date.now() + INFO_WAIT_MS) });
        publish(row.userId, { type: "call.stage", callId: row.id, stage: "talk", line: `Calling you to join: ${args.question}` });
        await push(row.userId, `${row.name}: Ringo is calling you`, `Pick up to join the call. The rep needs: ${args.question}`, { outCallId: row.id });
        return { answered: false, conference: true, instruction: CONFERENCE_INSTRUCTION };
      }
    }

    // "Text me": the question also goes out by SMS or WhatsApp, and a reply answers it (routes/webhooks.ts).
    // The app notification still goes out, so whichever the user sees first works.
    const textMode = (TEXT_MODES as readonly string[]).includes(user?.infoMode ?? "") && user?.phone && user.verified && textConfigured(user.infoMode as TextMode)
      ? (user.infoMode as TextMode) : null;
    // Over text a decision gets the same 2 minutes as info: people need longer to see a text than a push.
    const expiresAt = new Date(Date.now() + (kind === "decision" && !textMode ? ASK_TIMEOUT_MS : INFO_WAIT_MS));
    const [ask] = await db.insert(schema.asks).values({ outCallId: row.id, kind, question: args.question, expiresAt, via: textMode ?? "prompt" }).returning();
    if (textMode) {
      try {
        const sid = await sendText(textMode, user!.phone!, questionText(kind, row.name, args.question));
        await db.update(schema.asks).set({ messageSids: [sid] }).where(eq(schema.asks.id, ask!.id));
      } catch (e) {
        // Not delivered (sender not registered, not in the WhatsApp sandbox…): fall back to the app only.
        req.log.warn({ err: (e as Error).message, mode: textMode }, "ask text failed");
        await db.update(schema.asks).set({ via: "prompt" }).where(eq(schema.asks.id, ask!.id));
      }
    }
    const [u] = await db.update(schema.outCalls).set({ status: "awaiting_user" }).where(eq(schema.outCalls.id, row.id)).returning();
    if (u) publish(row.userId, { type: "call.updated", call: toOutCall(u) });
    publish(row.userId, {
      type: "call.ask", callId: row.id, askId: ask!.id, kind, question: args.question,
      options: kind === "decision" ? ["accept", "counter", "takeover", "end"] : ["reply", "takeover"], expiresAt: expiresAt.toISOString(),
    });
    const title = kind === "code" ? `${row.name} needs a code` : kind === "info" ? `${row.name} needs information` : `${row.name}: decision needed`;
    if (!isOnline(row.userId) || kind !== "decision" || textMode) await push(row.userId, title, args.question, { outCallId: row.id, askId: ask!.id });
    if (kind !== "decision" || textMode) endIfUnanswered(ask!.id, row.id, expiresAt);

    return respond(ask!.id, row, kind, expiresAt);
  });

  /** Follow-up long poll for an ask that wasn't answered within one request. Never waits past the ask's 2-minute limit. */
  app.post("/retell/tools/wait_for_answer", async (req) => {
    const { call, args } = req.body as { call: RetellCall; args: { ask_id?: string } };
    const row = await outCallFor(call);
    if (!row) return { answered: false, instruction: "Tell the rep you'll call back, then end the call." };
    const [ask] = args.ask_id
      ? await db.select().from(schema.asks).where(and(eq(schema.asks.id, args.ask_id), eq(schema.asks.outCallId, row.id)))
      : await db.select().from(schema.asks).where(eq(schema.asks.outCallId, row.id)).orderBy(desc(schema.asks.createdAt)).limit(1);
    if (!ask) return { answered: false, instruction: TIMEOUT_INSTRUCTION };
    return respond(ask.id, row, ask.kind, ask.expiresAt);
  });
}

const CONFERENCE_INSTRUCTION = 'The account holder asked to be connected for this. Tell the rep: "I\'ll bring the account holder on the line now, please hold for a moment," then call conference_user. If the transfer fails because they don\'t pick up, apologize, say they\'ll call back, ask for a reference number, and end the call.';
const TIMEOUT_INSTRUCTION = "The account holder didn't answer within 2 minutes. Don't agree to anything. Apologize to the rep, say the account holder will call back, ask for a reference number, and end the call.";

type Row = NonNullable<Awaited<ReturnType<typeof outCallFor>>>;

/** Waits (at most one request's worth) for the answer and tells the agent what to do next. */
async function respond(askId: string, row: Row, kind: "decision" | "code" | "info", expiresAt: Date) {
  const until = new Date(Math.min(expiresAt.getTime(), Date.now() + ASK_TIMEOUT_MS));
  const answered = await waitForAnswer(askId, until);
  if (!answered && Date.now() < expiresAt.getTime() - 2000) {
    const left = Math.round((expiresAt.getTime() - Date.now()) / 1000);
    return {
      answered: false, still_waiting: true, ask_id: askId, seconds_left: left,
      instruction: `Still waiting for the account holder (${left}s left). Tell the rep briefly that they're checking ("Thanks for your patience, they're just getting that for me"), then call wait_for_answer with ask_id "${askId}".`,
    };
  }
  await db.update(schema.outCalls).set({ status: "in_progress" }).where(and(eq(schema.outCalls.id, row.id), eq(schema.outCalls.status, "awaiting_user")));
  if (!answered) {
    const [gone] = await db.update(schema.asks).set({ answeredAt: new Date(), answer: "timeout" }).where(and(eq(schema.asks.id, askId), isNull(schema.asks.answeredAt))).returning();
    if (gone?.messageSids?.length) void forgetMessages(gone.messageSids);
    publish(row.userId, { type: "call.ask_resolved", callId: row.id, askId });
    return {
      answered: false,
      instruction: kind === "decision" ? "The account holder didn't respond. Don't accept anything. Ask for a reference number and say they'll call back." : TIMEOUT_INSTRUCTION,
    };
  }
  // Codes and account details go to the agent once; Ringo doesn't keep them.
  if (answered.answer === "reply" && kind !== "decision") await db.update(schema.asks).set({ note: null }).where(eq(schema.asks.id, askId));
  if (answered.messageSids?.length) void forgetMessages(answered.messageSids);
  const instructions: Record<string, string> = {
    accept: "The account holder accepts. Confirm the details and ask for a reference number.",
    counter: "The account holder declines. Ask politely for a better outcome, or for a supervisor.",
    takeover: `The account holder wants to join the call. ${CONFERENCE_INSTRUCTION}`,
    end: "Thank the rep and end the call.",
    reply: `The account holder replied: "${answered.note ?? ""}". Use it to answer the rep. Don't repeat it more than needed.`,
  };
  return { answered: true, choice: answered.answer, note: answered.note ?? "", instruction: instructions[answered.answer ?? "end"] };
}

/**
 * Backstop for the 2-minute limit: if the user never answered, end the call even if the agent didn't.
 * A short grace period lets the agent say goodbye and ask for a reference number first.
 */
function endIfUnanswered(askId: string, outCallId: string, expiresAt: Date) {
  const t = setTimeout(async () => {
    try {
      const [a] = await db.select().from(schema.asks).where(eq(schema.asks.id, askId));
      if (a?.answeredAt && a.answer !== "timeout") return;
      const [c] = await db.select().from(schema.outCalls).where(eq(schema.outCalls.id, outCallId));
      if (!c?.retellCallId || !["in_progress", "awaiting_user"].includes(c.status)) return;
      await retell.call.stop(c.retellCallId).catch(() => undefined);
      await audit(c.userId, "call.ask_timeout", { outCallId, askId });
    } catch {
      // Best effort; the agent was told to end the call too.
    }
  }, expiresAt.getTime() - Date.now() + END_GRACE_MS);
  t.unref?.();
}

async function waitForAnswer(askId: string, until: Date) {
  while (Date.now() < until.getTime()) {
    const [a] = await db.select().from(schema.asks).where(eq(schema.asks.id, askId));
    if (a?.answeredAt) return a;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** Pulls the numbers out of post-call analysis: money saved, a follow-up date, a confirmed appointment. */
export function callFacts(row: Row, data: Record<string, unknown>, outcome: Outcome, tz: string) {
  const ok = outcome === "success" || outcome === "partial";
  const saved = Number(data.saved_amount);
  const r = row.reservation;
  const appt = ok ? (parseLocal(data.appointment_time, tz) ?? (row.category === "reservation" && r ? zoned(r.date, r.time, tz) : null)) : null;
  const follow = parseLocal(data.follow_up_date, tz, "10:00");
  return {
    savedCents: ok && Number.isFinite(saved) && saved > 0 && saved < 100_000 ? Math.round(saved * 100) : null,
    followUpAt: follow && follow.getTime() > Date.now() ? follow : null,
    followUpNote: data.follow_up_reason ? String(data.follow_up_reason).slice(0, 300) : null,
    appointmentAt: appt,
  };
}

/** Puts a confirmed booking on the user's Google Calendar, if they connected it and left "Save to my calendar" on. */
async function saveToCalendar(user: typeof schema.users.$inferSelect, c: Row & { appointmentAt: Date | null; reference: string | null; summary: string }, tz: string) {
  if (!user.googleRefreshToken || !user.calendarSave || !c.appointmentAt || c.calendarEventId) return;
  const party = c.reservation?.party;
  try {
    const id = await addEvent(user, {
      title: c.category === "reservation" ? `${c.name}${party ? ` (table for ${party})` : ""}` : `${c.name} appointment`,
      start: c.appointmentAt, minutes: c.category === "reservation" ? 90 : 60, tz,
      description: [c.summary, c.reference ? `Confirmation: ${c.reference}` : "", `Phone: ${c.number}`, "Booked by Ringo"].filter(Boolean).join("\n"),
    });
    if (!id) return;
    await db.update(schema.outCalls).set({ calendarEventId: id }).where(eq(schema.outCalls.id, c.id));
    await push(user.id, "Added to your calendar", `${c.name}, ${fmtDay(c.appointmentAt, tz)} at ${fmtTime(c.appointmentAt, tz)}`, { outCallId: c.id });
  } catch {
    // Calendar is a nice-to-have; the call result is already saved.
  }
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
    summary: String(data.message || call.call_analysis?.call_summary || ""),
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
