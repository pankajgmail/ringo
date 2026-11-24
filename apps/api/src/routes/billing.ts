import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { billingConfigured, billingSummary, checkoutUrl, isSubscribed, portalUrl } from "../services/billing.ts";

// Where Stripe may send the browser back to: the web app itself, or the native app's scheme.
const ReturnTo = z.string().refine((r) => r.startsWith("ringo://") || r.startsWith(new URL(env.PUBLIC_URL).origin + "/"), "bad return URL");

/** Signed-in billing routes: plan status, start a subscription, manage it. */
export async function billingRoutes(app: FastifyInstance) {
  app.get("/v1/billing", async (req) => billingSummary(req.user));

  app.post("/v1/billing/checkout", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "Payments aren't switched on yet." });
    if (isSubscribed(req.user)) return reply.code(409).send({ error: "You're already subscribed." });
    const { returnTo } = z.object({ returnTo: ReturnTo }).parse(req.body);
    return { url: await checkoutUrl(req.user, returnTo) };
  });

  app.post("/v1/billing/portal", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!billingConfigured()) return reply.code(503).send({ error: "Payments aren't switched on yet." });
    if (!req.user.stripeCustomerId) return reply.code(404).send({ error: "No subscription yet." });
    const { returnTo } = z.object({ returnTo: ReturnTo }).parse(req.body);
    return { url: await portalUrl(req.user, returnTo) };
  });
}
