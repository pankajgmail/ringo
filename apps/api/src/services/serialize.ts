import type { InCall, OutCall } from "@ringo/shared";
import type { schema } from "../db/client.ts";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toOutCall(r: typeof schema.outCalls.$inferSelect): OutCall {
  return {
    id: r.id, providerId: r.providerId, name: r.name, number: r.number, category: r.category, priority: r.priority,
    goal: r.goal, limits: r.limits, askMe: r.askMe, reservation: r.reservation ?? null, status: r.status, stage: r.stage,
    scheduledAt: r.scheduledAt.toISOString(), startedAt: iso(r.startedAt), endedAt: iso(r.endedAt),
    durationSec: r.durationSec, holdSec: r.holdSec, outcome: r.outcome, summary: r.summary, reference: r.reference, costCents: r.costCents,
  };
}

export function toInCall(r: typeof schema.inCalls.$inferSelect): InCall {
  return {
    id: r.id, fromNumber: r.fromNumber, callerName: r.callerName, type: r.type, summary: r.summary,
    callbackNumber: r.callbackNumber, startedAt: r.startedAt.toISOString(), durationSec: r.durationSec,
  };
}
