import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { HELP_TEXT, forgetMessages, keyword, parseReply, validTwilio } from "../services/messaging.ts";
import { publish } from "../services/live.ts";
import { handleStripeEvent, stripe } from "../services/billing.ts";

const twiml = (msg?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</Message>` : ""}</Response>`;

/** Public webhooks (no user session): Twilio message replies and Stripe billing events. Each is signature-checked. */
export async function webhookRoutes(app: FastifyInstance) {
  // Twilio posts form-encoded bodies.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  /**
   * A reply to a question Ringo texted (SMS or WhatsApp). The sender's number finds the user; their newest open
   * question by text gets the answer, the same as tapping it in the app. Both messages are then deleted from Twilio.
   */
  app.post("/v1/webhooks/twilio/message", async (req, reply) => {
    const p = (req.body ?? {}) as Record<string, string>;
    const url = `${env.PUBLIC_URL.replace(/\/$/, "")}${req.url}`;
    if (!validTwilio(req.headers["x-twilio-signature"] as string | undefined, url, p)) return reply.code(403).send("bad signature");
    reply.type("text/xml");

    const from = (p.From ?? "").replace(/^whatsapp:/, "");
    const text = (p.Body ?? "").trim();
    if (!from || !text) return twiml();
    const users = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.phone, from), isNotNull(schema.users.phoneVerifiedAt)));

    // STOP / HELP: never an answer to a call. STOP also switches the user back to in-app questions.
    // Twilio sends its own opt-out confirmation, so Ringo doesn't reply to STOP.
    const kw = keyword(text, p.OptOutType);
    if (kw === "help") return twiml(HELP_TEXT);
    if (kw === "stop") {
      for (const u of users) {
        await db.update(schema.users).set({ infoMode: "prompt" }).where(and(eq(schema.users.id, u.id), inArray(schema.users.infoMode, ["sms", "whatsapp"])));
        await audit(u.id, "sms.opt_out", {});
      }
      return twiml();
    }
    if (kw === "start" || !users.length) return twiml();

    const [open] = await db.select({ ask: schema.asks, userId: schema.outCalls.userId, callId: schema.outCalls.id, name: schema.outCalls.name })
      .from(schema.asks).innerJoin(schema.outCalls, eq(schema.asks.outCallId, schema.outCalls.id))
      .where(and(
        inArray(schema.outCalls.userId, users.map((u) => u.id)),
        inArray(schema.asks.via, ["sms", "whatsapp"]),
        isNull(schema.asks.answeredAt), gt(schema.asks.expiresAt, new Date()),
      ))
      .orderBy(desc(schema.asks.createdAt)).limit(1);
    if (!open) return twiml("Ringo isn't waiting on an answer right now. Open the app to see your calls.");

    const a = parseReply(open.ask.kind, text);
    const sids = [...open.ask.messageSids, ...(p.MessageSid ? [p.MessageSid] : [])];
    const [done] = await db.update(schema.asks).set({ answer: a.choice, note: a.note, answeredAt: new Date(), messageSids: sids })
      .where(and(eq(schema.asks.id, open.ask.id), isNull(schema.asks.answeredAt))).returning({ id: schema.asks.id });
    if (!done) return twiml("That question was already answered.");
    publish(open.userId, { type: "call.ask_resolved", callId: open.callId, askId: open.ask.id });
    await audit(open.userId, "ask.answered", { askId: open.ask.id, via: open.ask.via, choice: a.choice });
    // Wait so Twilio has finished delivering, then wipe the question and the reply (they can hold a PIN).
    setTimeout(() => void forgetMessages(sids), 15_000).unref?.();

    const ack = a.choice === "takeover" ? "Calling you now to join." : a.choice === "accept" ? "Got it, accepting." : a.choice === "counter" ? "Got it, declining." : a.choice === "end" ? "Ending the call." : `Thanks, passing that to ${open.name}.`;
    return twiml(ack);
  });

  /** Stripe billing events. The signature is over the raw body, kept by the JSON parser in app.ts. */
  app.post("/v1/webhooks/stripe", { config: { rateLimit: false } }, async (req, reply) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "billing off" });
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync((req as unknown as { rawBody: string }).rawBody, req.headers["stripe-signature"] as string, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      return reply.code(400).send({ error: "bad signature" });
    }
    await handleStripeEvent(event);
    return { received: true };
  });
}
