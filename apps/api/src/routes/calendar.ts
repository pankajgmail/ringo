import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../env.ts";
import { CalendarError, authUrl, calendarConfigured, connect, disconnect, readState } from "../services/calendar.ts";

// Where the browser may be sent back to after Google: the web app itself, or the native app's scheme.
const ReturnTo = z.string().refine((r) => r.startsWith("ringo://") || r.startsWith(new URL(env.PUBLIC_URL).origin + "/"), "bad return URL");

const back = (returnTo: string, status: "connected" | "error", msg = "") => {
  const u = new URL(returnTo);
  u.searchParams.set("calendar", status);
  if (msg) u.searchParams.set("message", msg);
  return u.toString();
};

/** Signed-in routes: start the Google consent flow, disconnect. */
export async function calendarRoutes(app: FastifyInstance) {
  app.post("/v1/calendar/connect", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!calendarConfigured()) return reply.code(503).send({ error: "Google Calendar isn't switched on yet." });
    const { returnTo } = z.object({ returnTo: ReturnTo }).parse(req.body);
    return { url: await authUrl(req.user.id, returnTo) };
  });

  app.delete("/v1/calendar", async (req) => {
    await disconnect(req.user);
    return { ok: true };
  });
}

/** Google redirects the browser here (no app session), so the user comes from the encrypted state. */
export async function calendarCallback(app: FastifyInstance) {
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/v1/calendar/callback", async (req, reply) => {
    let returnTo = `${new URL(env.PUBLIC_URL).origin}/settings`;
    try {
      const s = await readState(req.query.state ?? "");
      returnTo = ReturnTo.parse(s.returnTo);
      if (req.query.error || !req.query.code) return reply.redirect(back(returnTo, "error", req.query.error === "access_denied" ? "You didn't allow calendar access." : "Google didn't finish connecting."));
      await connect(s.userId, req.query.code);
      return reply.redirect(back(returnTo, "connected"));
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, "calendar connect failed");
      return reply.redirect(back(returnTo, "error", e instanceof CalendarError ? e.message : "Couldn't connect Google Calendar."));
    }
  });
}
