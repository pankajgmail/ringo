import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AnswerSchema, OutCallInputSchema, PRIORITY_QUEUE, PROVIDERS, RepeatCallSchema } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { audit } from "../lib/audit.ts";
import { checkDialable } from "../lib/safety.ts";
import { enqueueCall } from "../jobs/queue.ts";
import { finish } from "../jobs/dialer.ts";
import { retell } from "../services/retell.ts";
import { publish } from "../services/live.ts";
import { toInCall, toOutCall } from "../services/serialize.ts";
import { assertCanCall } from "../services/billing.ts";

export async function callRoutes(app: FastifyInstance) {
  app.post("/v1/calls", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const input = OutCallInputSchema.parse(req.body);
    if (!req.user.phoneVerifiedAt) return reply.code(403).send({ error: "Verify your phone number before RingVo can call for you" });
    await assertCanCall(req.user);
    const provider = PROVIDERS.find((p) => p.id === input.providerId);
    const number = input.providerId === "custom" ? input.number! : provider?.number;
    if (!number) return reply.code(400).send({ error: "Unknown provider" });
    const blocked = checkDialable(number);
    if (blocked) return reply.code(400).send({ error: blocked });

    const at = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    const [row] = await db.insert(schema.outCalls).values({
      userId: req.user.id,
      providerId: input.providerId,
      name: input.providerId === "custom" ? input.name! : provider!.name,
      number,
      category: input.category,
      priority: input.priority,
      goal: input.goal,
      limits: input.limits,
      askMe: input.askMe,
      holdForMe: input.holdForMe,
      reservation: input.reservation ?? null,
      scheduledAt: at,
      status: at.getTime() <= Date.now() ? "queued" : "scheduled",
    }).returning();
    const jobId = await enqueueCall(row!.id, at, PRIORITY_QUEUE[input.priority]);
    await db.update(schema.outCalls).set({ jobId }).where(eq(schema.outCalls.id, row!.id));
    await audit(req.user.id, "call.created", { outCallId: row!.id, providerId: input.providerId });
    return reply.code(201).send(toOutCall(row!));
  });

  /**
   * "Call again" / follow up: a new call with the same brief as a finished one. For a follow-up the goal says what the
   * rep promised last time and quotes the reference number, so the next rep can pick it up.
   */
  app.post<{ Params: { id: string } }>("/v1/calls/:id/repeat", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { scheduledAt } = RepeatCallSchema.parse(req.body ?? {});
    if (!req.user.phoneVerifiedAt) return reply.code(403).send({ error: "Verify your phone number before RingVo can call for you" });
    await assertCanCall(req.user);
    const [src] = await db.select().from(schema.outCalls).where(and(eq(schema.outCalls.id, req.params.id), eq(schema.outCalls.userId, req.user.id)));
    if (!src) return reply.code(404).send({ error: "not found" });
    if (!["completed", "cancelled", "failed"].includes(src.status)) return reply.code(409).send({ error: "That call hasn't finished yet" });
    const blocked = checkDialable(src.number);
    if (blocked) return reply.code(400).send({ error: blocked });
    const followUp = !!(src.followUpAt || src.reference || src.summary) && src.status === "completed";
    const goal = followUp
      ? `Follow-up to an earlier call. Last time: ${src.summary ?? ""}${src.reference ? ` Reference number: ${src.reference}.` : ""}${src.followUpNote ? ` They said: ${src.followUpNote}.` : ""} Original goal: ${src.goal}`.slice(0, 1000)
      : src.goal;
    const at = scheduledAt ? new Date(scheduledAt) : new Date();
    const [row] = await db.insert(schema.outCalls).values({
      userId: req.user.id, providerId: src.providerId, name: src.name, number: src.number, category: src.category, priority: src.priority,
      goal, limits: src.limits, askMe: src.askMe, holdForMe: src.holdForMe, parentId: src.id,
      // A booking's date may have passed; keep it only if it's still ahead.
      reservation: src.reservation && new Date(`${src.reservation.date}T23:59:59`) > new Date() ? src.reservation : null,
      scheduledAt: at, status: at.getTime() <= Date.now() ? "queued" : "scheduled",
    }).returning();
    if (row!.category === "reservation" && !row!.reservation) {
      await db.delete(schema.outCalls).where(eq(schema.outCalls.id, row!.id));
      return reply.code(400).send({ error: "That booking date has passed. Start a new booking instead." });
    }
    const jobId = await enqueueCall(row!.id, at, PRIORITY_QUEUE[row!.priority]);
    await db.update(schema.outCalls).set({ jobId }).where(eq(schema.outCalls.id, row!.id));
    if (src.followUpAt) await db.update(schema.outCalls).set({ followUpAt: null }).where(eq(schema.outCalls.id, src.id));
    await audit(req.user.id, "call.repeated", { outCallId: row!.id, from: src.id });
    return reply.code(201).send(toOutCall(row!));
  });

  /** Missed call → "Have RingVo call them back": a new outbound call to the caller, briefed with their message. */
  app.post<{ Params: { id: string } }>("/v1/in-calls/:id/callback", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!req.user.phoneVerifiedAt) return reply.code(403).send({ error: "Verify your phone number before RingVo can call for you" });
    await assertCanCall(req.user);
    const body = (req.body ?? {}) as { goal?: string };
    const [ic] = await db.select().from(schema.inCalls).where(and(eq(schema.inCalls.id, req.params.id), eq(schema.inCalls.userId, req.user.id)));
    if (!ic) return reply.code(404).send({ error: "not found" });
    if (ic.type === "spam") return reply.code(400).send({ error: "RingVo won't call back spam." });
    const number = ic.callbackNumber || ic.fromNumber;
    const blocked = checkDialable(number);
    if (blocked) return reply.code(400).send({ error: blocked });
    const who = ic.callerName || "the caller";
    const extra = typeof body.goal === "string" ? body.goal.trim().slice(0, 500) : "";
    const goal = `Return a missed call from ${who}. Their message: ${ic.summary || "none left"}. ${extra || "Find out what they need, answer what you can from the goal, and take a message for anything else."}`.slice(0, 1000);
    const [row] = await db.insert(schema.outCalls).values({
      userId: req.user.id, providerId: "custom", name: ic.callerName || number, number, category: "general", priority: ic.type === "important" ? "high" : "medium",
      goal, limits: "Don't commit to anything on the account holder's behalf; take a message instead.", askMe: "ask", scheduledAt: new Date(), status: "queued",
    }).returning();
    const jobId = await enqueueCall(row!.id, new Date(), PRIORITY_QUEUE[row!.priority]);
    await db.update(schema.outCalls).set({ jobId }).where(eq(schema.outCalls.id, row!.id));
    await audit(req.user.id, "call.callback", { outCallId: row!.id, inCallId: ic.id });
    return reply.code(201).send(toOutCall(row!));
  });

  /** Money and time RingVo saved, for the home-screen card. */
  app.get("/v1/savings", async (req) => {
    const [r] = await db.select({
      savedCents: sql<number>`coalesce(sum(${schema.outCalls.savedCents}), 0)::int`,
      holdSec: sql<number>`coalesce(sum(${schema.outCalls.holdSec}), 0)::int`,
      talkSec: sql<number>`coalesce(sum(${schema.outCalls.durationSec}), 0)::int`,
      done: sql<number>`count(*) filter (where ${schema.outCalls.outcome} in ('success','partial'))::int`,
      monthSavedCents: sql<number>`coalesce(sum(${schema.outCalls.savedCents}) filter (where ${schema.outCalls.endedAt} >= date_trunc('month', now())), 0)::int`,
    }).from(schema.outCalls).where(eq(schema.outCalls.userId, req.user.id));
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.inCalls).where(eq(schema.inCalls.userId, req.user.id));
    return { ...r!, inCalls: n };
  });

  app.get<{ Querystring: { status?: "upcoming" | "history" } }>("/v1/calls", async (req) => {
    const upcoming = ["scheduled", "queued", "dialing", "in_progress", "awaiting_user"] as const;
    const finished = ["completed", "cancelled", "failed"] as const;
    const rows = await db.select().from(schema.outCalls)
      .where(and(eq(schema.outCalls.userId, req.user.id), inArray(schema.outCalls.status, req.query.status === "history" ? [...finished] : [...upcoming])))
      .orderBy(desc(schema.outCalls.scheduledAt)).limit(100);
    return rows.map(toOutCall);
  });

  app.get<{ Params: { id: string } }>("/v1/calls/:id", async (req, reply) => {
    const [row] = await db.select().from(schema.outCalls).where(and(eq(schema.outCalls.id, req.params.id), eq(schema.outCalls.userId, req.user.id)));
    if (!row) return reply.code(404).send({ error: "not found" });
    return { ...toOutCall(row), transcript: row.transcript };
  });

  app.post<{ Params: { id: string } }>("/v1/calls/:id/cancel", async (req, reply) => {
    const [row] = await db.select().from(schema.outCalls).where(and(eq(schema.outCalls.id, req.params.id), eq(schema.outCalls.userId, req.user.id)));
    if (!row) return reply.code(404).send({ error: "not found" });
    if (["completed", "cancelled", "failed"].includes(row.status)) return reply.code(409).send({ error: "Call already finished" });
    if (row.retellCallId) await retell.call.stop(row.retellCallId).catch(() => undefined);
    await finish(row.id, req.user.id, { status: "cancelled", outcome: "cancelled", summary: "You ended the call." });
    return { ok: true };
  });

  /** User answers a mid-call question raised by the agent's ask_user tool. */
  app.post<{ Params: { id: string; askId: string } }>("/v1/calls/:id/asks/:askId", async (req, reply) => {
    const answer = AnswerSchema.parse(req.body);
    const [row] = await db.select().from(schema.outCalls).where(and(eq(schema.outCalls.id, req.params.id), eq(schema.outCalls.userId, req.user.id)));
    if (!row) return reply.code(404).send({ error: "not found" });
    const [ask] = await db.update(schema.asks).set({ answer: answer.choice, note: answer.note ?? null, answeredAt: new Date() })
      .where(and(eq(schema.asks.id, req.params.askId), eq(schema.asks.outCallId, row.id), isNull(schema.asks.answeredAt)))
      .returning();
    if (!ask) return reply.code(409).send({ error: "Already answered or expired" });
    publish(req.user.id, { type: "call.ask_resolved", callId: row.id, askId: ask.id });
    return { ok: true };
  });

  app.get("/v1/in-calls", async (req) => {
    const rows = await db.select().from(schema.inCalls).where(eq(schema.inCalls.userId, req.user.id)).orderBy(desc(schema.inCalls.startedAt)).limit(100);
    return rows.map(toInCall);
  });
}
