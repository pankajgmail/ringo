import type { FastifyInstance } from "fastify";
import { FeedbackSchema } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { audit } from "../lib/audit.ts";

/** Star rating + comment from the app. Kept with the user so it's deleted with their account. */
export async function feedbackRoutes(app: FastifyInstance) {
  app.post("/v1/feedback", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    const f = FeedbackSchema.parse(req.body);
    const [row] = await db.insert(schema.feedback).values({
      userId: req.user.id, rating: f.rating, comment: f.comment || null, platform: f.platform ?? null, appVersion: f.appVersion ?? null,
    }).returning({ id: schema.feedback.id });
    await audit(req.user.id, "feedback.sent", { rating: f.rating });
    return { ok: true, id: row!.id };
  });
}
