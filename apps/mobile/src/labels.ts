import type { Category, InCallType, Outcome, Priority, Stage } from "@ringo/shared";
import { c } from "./theme.ts";

export const CATEGORY: Record<Category, { label: string; placeholder: string; quick: [string, string][] }> = {
  billing: { label: "Billing", placeholder: "What should Ringo get done?", quick: [["Waive late fee", "Get the late fee on my latest bill waived."], ["Remove extra charge", "Remove the unexpected extra charge on my latest bill."], ["Lower my bill", "Ask for any promotions or discounts to lower my monthly bill."]] },
  service: { label: "Service", placeholder: "What should change?", quick: [["Cancel service", "Cancel my service effective the end of this billing cycle."], ["Change plan", "Move me to a cheaper plan with similar features."], ["Report outage", "Report an outage at my address and ask for an ETA."]] },
  reservation: { label: "Booking", placeholder: "Any special requests?", quick: [["Quiet table", "Request a quiet table."], ["Birthday", "It's a birthday celebration."], ["Window seat", "Request a window seat if possible."]] },
  general: { label: "Other", placeholder: "What do you need to know?", quick: [["Order status", "Ask for the status of my latest order."], ["Opening hours", "Ask for their opening hours this week."]] },
};

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  high: { label: "High", color: c.high }, medium: { label: "Medium", color: c.medium }, low: { label: "Low", color: c.low },
};

export const OUTCOME: Record<Outcome, { label: string; color: string; bg: string }> = {
  success: { label: "Success", color: c.ok, bg: c.okSoft }, partial: { label: "Partial", color: c.warn, bg: c.warnSoft },
  failed: { label: "Failed", color: c.bad, bg: c.badSoft }, cancelled: { label: "Cancelled", color: c.muted, bg: c.card2 },
};

export const IN_TYPE: Record<InCallType, { label: string; color: string; bg: string }> = {
  important: { label: "Important", color: c.warn, bg: c.warnSoft }, message: { label: "Message", color: c.info, bg: c.infoSoft }, spam: { label: "Spam", color: c.muted, bg: c.card2 },
};

export const STAGE_LABEL: Record<Stage, string> = { queue: "Queue", dial: "Dial", menu: "Menu", hold: "Hold", talk: "Talk", done: "Done" };
