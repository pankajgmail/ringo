// Domain vocabulary shared by API, mobile/web app and Retell agent config.
// Mirrors the prototype (docs/prototype.html) so the UI can be ported 1:1.

export const CATEGORIES = ["billing", "service", "reservation", "general"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** What the agent does when the counterparty makes an offer outside the brief. */
export const ASK_ME = ["ask", "decline", "end"] as const;
export type AskMe = (typeof ASK_ME)[number];

export const OUT_CALL_STATUSES = ["scheduled", "queued", "dialing", "in_progress", "awaiting_user", "completed", "cancelled", "failed"] as const;
export type OutCallStatus = (typeof OUT_CALL_STATUSES)[number];

export const OUTCOMES = ["success", "partial", "failed", "cancelled"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Live stage shown in the call tracker. */
export const STAGES = ["queue", "dial", "menu", "hold", "talk", "done"] as const;
export type Stage = (typeof STAGES)[number];

export const IN_CALL_TYPES = ["important", "message", "spam"] as const;
export type InCallType = (typeof IN_CALL_TYPES)[number];

export const CARRIERS = ["att", "tmobile", "verizon"] as const;
export type Carrier = (typeof CARRIERS)[number];

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
/** pg-boss: higher number runs first. */
export const PRIORITY_QUEUE: Record<Priority, number> = { high: 10, medium: 5, low: 0 };

export interface Provider {
  id: string;
  name: string;
  number: string;
  color: string;
}

/** Curated directory; "custom" means user-entered name + number. */
export const PROVIDERS: Provider[] = [
  { id: "att", name: "AT&T", number: "+18002882020", color: "#00a8e0" },
  { id: "verizon", name: "Verizon", number: "+18009220204", color: "#cd040b" },
  { id: "tmobile", name: "T-Mobile", number: "+18009378997", color: "#e20074" },
  { id: "xfinity", name: "Xfinity", number: "+18009346489", color: "#6138f5" },
  { id: "spectrum", name: "Spectrum", number: "+18332676094", color: "#0067b8" },
];

/**
 * Carrier conditional-forwarding codes (see requirements doc §2.3).
 * GSM carriers allow a 5–30s no-answer timer; Verizon uses the carrier default.
 */
export function forwardingCodes(carrier: Carrier, ringoNumber: string) {
  const n = ringoNumber.replace(/[^\d+]/g, "");
  if (carrier === "verizon") {
    return { noAnswer: `*71${n.replace(/^\+1/, "")}`, busy: null, unreachable: null, check: null, disable: "*73" };
  }
  return { noAnswer: `**61*${n}*11*30#`, busy: `**67*${n}#`, unreachable: `**62*${n}#`, check: "*#61#", disable: "##61#" };
}
