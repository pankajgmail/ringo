import { buildApp } from "./app.ts";
import { env } from "./env.ts";
import { boss, startQueue } from "./jobs/queue.ts";
import { startDialer } from "./jobs/dialer.ts";
import { pool } from "./db/client.ts";

const app = await buildApp();
await startQueue();
await startDialer();
await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, "shutting down");
    await app.close();
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  });
}
