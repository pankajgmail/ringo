import type { FastifyInstance } from "fastify";
import { avg, count, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import type { User } from "../lib/auth.ts";
import { audit } from "../lib/audit.ts";

/** Admins are listed by email in ADMIN_EMAILS. The email comes from the verified Google/Apple sign-in. */
export const isAdmin = (u: User) => env.ADMIN_EMAILS.includes(u.email.toLowerCase());

const UPCOMING = ["scheduled", "queued"] as const;
const LIVE = ["dialing", "in_progress", "awaiting_user"] as const;

/** Owner dashboard: who signed up, outbound vs inbound share, and how outbound calls ended up. */
export async function adminRoutes(app: FastifyInstance) {
  app.get("/v1/admin/stats", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!isAdmin(req.user)) return reply.code(403).send({ error: "Admins only" });

    const outCount = db.select({ userId: schema.outCalls.userId, n: count().as("out_n") }).from(schema.outCalls).groupBy(schema.outCalls.userId).as("oc");
    const inCount = db.select({ userId: schema.inCalls.userId, n: count().as("in_n") }).from(schema.inCalls).groupBy(schema.inCalls.userId).as("ic");

    const weekAgo = new Date(Date.now() - 7 * 864e5);
    const [[totals], users, byStatus, [inbound], [fbTotals], fbStars, fbRecent] = await Promise.all([
      db.select({
        total: count(),
        last7d: sql<number>`count(*) filter (where ${schema.users.createdAt} > ${weekAgo})::int`,
        verified: sql<number>`count(*) filter (where ${schema.users.phoneVerifiedAt} is not null)::int`,
      }).from(schema.users),
      db.select({
        id: schema.users.id, name: schema.users.name, email: schema.users.email, joinedAt: schema.users.createdAt,
        phoneVerified: sql<boolean>`${schema.users.phoneVerifiedAt} is not null`,
        outCalls: sql<number>`coalesce(${outCount.n}, 0)::int`, inCalls: sql<number>`coalesce(${inCount.n}, 0)::int`,
      }).from(schema.users)
        .leftJoin(outCount, eq(outCount.userId, schema.users.id))
        .leftJoin(inCount, eq(inCount.userId, schema.users.id))
        .orderBy(desc(schema.users.createdAt)).limit(500),
      db.select({ status: schema.outCalls.status, n: count() }).from(schema.outCalls).groupBy(schema.outCalls.status),
      db.select({ n: count() }).from(schema.inCalls),
      db.select({ n: count(), avg: avg(schema.feedback.rating) }).from(schema.feedback),
      db.select({ rating: schema.feedback.rating, n: count() }).from(schema.feedback).groupBy(schema.feedback.rating),
      db.select({ id: schema.feedback.id, rating: schema.feedback.rating, comment: schema.feedback.comment, platform: schema.feedback.platform,
        at: schema.feedback.createdAt, name: schema.users.name, email: schema.users.email })
        .from(schema.feedback).innerJoin(schema.users, eq(schema.users.id, schema.feedback.userId))
        .orderBy(desc(schema.feedback.createdAt)).limit(50),
    ]);

    const st = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
    const sum = (keys: readonly string[]) => keys.reduce((a, k) => a + (st[k] ?? 0), 0);
    const out = Object.values(st).reduce((a, b) => a + b, 0);
    const inn = Number(inbound?.n ?? 0);

    await audit(req.user.id, "admin.stats");
    return {
      signups: { total: Number(totals?.total ?? 0), last7d: totals?.last7d ?? 0, verified: totals?.verified ?? 0 },
      users: users.map((u) => ({ ...u, joinedAt: u.joinedAt.toISOString() })),
      direction: { out, in: inn },
      feedback: {
        total: Number(fbTotals?.n ?? 0),
        average: fbTotals?.avg != null ? Math.round(Number(fbTotals.avg) * 10) / 10 : null,
        stars: [1, 2, 3, 4, 5].map((r) => Number(fbStars.find((x) => x.rating === r)?.n ?? 0)),
        recent: fbRecent.map((f) => ({ ...f, at: f.at.toISOString() })),
      },
      outcomes: { completed: st.completed ?? 0, upcoming: sum(UPCOMING), live: sum(LIVE), failed: st.failed ?? 0, cancelled: st.cancelled ?? 0 },
    };
  });
}
