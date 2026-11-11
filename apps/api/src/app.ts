import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { env } from "./env.ts";
import { requireUser, userFromToken } from "./lib/auth.ts";
import { pool } from "./db/client.ts";
import { meRoutes } from "./routes/me.ts";
import { callRoutes } from "./routes/calls.ts";
import { retellRoutes } from "./routes/retell.ts";
import { attach } from "./services/live.ts";

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === "production" ? "info" : "debug", redact: ["req.headers.authorization", "req.headers[\"x-retell-signature\"]"] },
    trustProxy: true,
    // ask_user long-polls up to ~90s
    requestTimeout: 120_000,
  });

  // Keep the raw body: Retell signatures are computed over the exact bytes.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    req.log.error(err);
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    return reply.code(status).send({ error: status >= 500 ? "internal_error" : e.message });
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(websocket);

  app.get("/health", async () => {
    await pool.query("select 1");
    return { ok: true };
  });

  // Webhooks and agent tools: Retell signature auth, no user session.
  await app.register(retellRoutes);

  // App API: Cognito-authenticated.
  await app.register(async (api) => {
    api.addHook("preHandler", requireUser);
    await api.register(meRoutes);
    await api.register(callRoutes);
  });

  // Live updates. Browsers can't set headers on WebSocket, so the token comes as a query param.
  app.get<{ Querystring: { token?: string; dev?: string } }>("/v1/live", { websocket: true }, async (socket, req) => {
    const user = await userFromToken(req.query.token, req.query.dev);
    if (!user) return socket.close(4401, "unauthorized");
    attach(user.id, socket);
    socket.send(JSON.stringify({ type: "hello" }));
  });

  return app;
}
