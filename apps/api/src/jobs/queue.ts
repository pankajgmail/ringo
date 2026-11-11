import { PgBoss } from "pg-boss";
import { env } from "../env.ts";

export const QUEUE = { placeCall: "place-call" } as const;
export type PlaceCallJob = { outCallId: string };

export const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
// Without a listener, a transient DB error is an unhandled 'error' event and crashes the process.
boss.on("error", (err) => console.error("[pg-boss]", err));

export async function startQueue() {
  await boss.start();
  await boss.createQueue(QUEUE.placeCall);
}

export function enqueueCall(outCallId: string, at: Date, priority: number) {
  return boss.send(QUEUE.placeCall, { outCallId } satisfies PlaceCallJob, {
    startAfter: at,
    priority,
    singletonKey: outCallId,
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
  });
}
