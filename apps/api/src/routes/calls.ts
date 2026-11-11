import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AnswerSchema, OutCallInputSchema, PRIORITY_QUEUE, PROVIDERS } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { audit } from "../lib/audit.ts";
import { checkDialable } from "../lib/safety.ts";
import { enqueueCall } from "../jobs/queue.ts";
import { finish } from "../jobs/dialer.ts";
import { retell } from "../services/retell.ts";
import { publish } from "../services/live.ts";
import { toInCall, toOutCall } from "../services/serialize.ts";

export async function callRoutes(app: FastifyInstance) {
  app.post("/v1/calls", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const input = OutCallInputSchema.parse(req.body);
    if (!req.user.phoneVerifiedAt) return reply.code(403).send({ error: "Verify your phone number before Ringo can call for you" });
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
      reservation: input.reservation ?? null,
      scheduledAt: at,
      status: at.getTime() <= Date.now() ? "queued" : "scheduled",
    }).returning();
    const jobId = await enqueueCall(row!.id, at, PRIORITY_QUEUE[input.priority]);
    await db.update(schema.outCalls).set({ jobId }).where(eq(schema.outCalls.id, row!.id));
    await audit(req.user.id, "call.created", { outCallId: row!.id, providerId: input.providerId });
    return reply.code(201).send(toOutCall(row!));
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
