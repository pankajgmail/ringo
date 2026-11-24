import type { Category, InCallType, Outcome, Priority, Stage } from "@ringo/shared";
import type { IconName } from "./icons.ts";
import { c } from "./theme.ts";

export const CATEGORY: Record<Category, { label: string; icon: IconName; placeholder: string; quick: [string, string][] }> = {
  billing: { label: "Billing", icon: "receipt", placeholder: "What should Ringvo get done?", quick: [["Waive late fee", "Get the late fee on my latest bill waived."], ["Remove extra charge", "Remove the unexpected extra charge on my latest bill."], ["Lower my bill", "Ask for any discount or promo to lower my monthly bill."]] },
  service: { label: "Service", icon: "wrench", placeholder: "What should change?", quick: [["Cancel service", "Cancel my service effective the end of this billing cycle."], ["Change plan", "Move me to a cheaper plan with similar features."], ["Report outage", "Report a service outage at my address and ask for a credit."]] },
  reservation: { label: "Booking", icon: "utensils", placeholder: "Any special requests?", quick: [["Quiet table", "Request a quiet table."], ["Birthday", "It's a birthday celebration."], ["Window seat", "Request a window seat if possible."]] },
  general: { label: "Other", icon: "help", placeholder: "What do you need to know?", quick: [["Order status", "Ask for the status of my latest order."], ["Opening hours", "Ask for their opening hours this week."]] },
};

export const PRIORITY: Record<Priority, { label: string; icon: IconName; color: string; bg: string; ring: string }> = {
  high: { label: "High", icon: "flame", color: c.high, bg: c.badSoft, ring: "rgba(248,113,113,.5)" },
  medium: { label: "Medium", icon: "flag", color: c.medium, bg: c.warnSoft, ring: "rgba(251,191,36,.5)" },
  low: { label: "Low", icon: "down", color: c.low, bg: c.infoSoft, ring: "rgba(96,165,250,.5)" },
};

export const OUTCOME: Record<Outcome, { label: string; icon: IconName; color: string; bg: string }> = {
  success: { label: "Success", icon: "check-circle", color: c.ok, bg: c.okSoft },
  partial: { label: "Partial", icon: "alert", color: c.warn, bg: c.warnSoft },
  failed: { label: "Failed", icon: "x-circle", color: c.bad, bg: c.badSoft },
  cancelled: { label: "Cancelled", icon: "ban", color: c.muted, bg: "#232a3f" },
};

export const IN_TYPE: Record<InCallType, { label: string; icon: IconName; color: string; bg: string }> = {
  important: { label: "Important", icon: "bell", color: c.bad, bg: c.badSoft },
  message: { label: "Message", icon: "msg", color: c.info, bg: c.infoSoft },
  sales: { label: "Offer", icon: "tag", color: c.amber, bg: c.warnSoft },
  spam: { label: "Spam", icon: "ban", color: c.muted, bg: "#232a3f" },
};

export const STAGE: Record<Stage, { label: string; icon: IconName }> = {
  queue: { label: "Queue", icon: "clock" }, dial: { label: "Dial", icon: "phone" }, menu: { label: "Menu", icon: "hash" },
  hold: { label: "Hold", icon: "music" }, talk: { label: "Talk", icon: "mic" }, done: { label: "Done", icon: "check" },
};
export const STAGE_LABEL: Record<Stage, string> = Object.fromEntries(Object.entries(STAGE).map(([k, v]) => [k, v.label])) as Record<Stage, string>;

export const CARRIER_LABEL = { att: "AT&T", tmobile: "T-Mobile", verizon: "Verizon" } as const;

/**
 * One-tap task templates: the jobs people most often hand to Ringo. Each fills in the call type, goal and limits;
 * the user still picks who to call. `who` hints which picker tab makes sense.
 */
export type Template = { id: string; label: string; icon: IconName; category: Category; goal: string; limits: string; who?: "provider" | "other"; holdForMe?: boolean };
export const TEMPLATES: Template[] = [
  { id: "lower", label: "Lower my bill", icon: "trend", category: "billing", goal: "Lower my monthly bill. Ask for any current promotions, loyalty discounts or a cheaper plan with the same service.", limits: "Accept any discount of $5/month or more. Don't add services, sign a new contract, or change equipment." },
  { id: "cancel", label: "Cancel a subscription", icon: "ban", category: "service", goal: "Cancel my subscription effective the end of the current billing period, and get a cancellation confirmation number.", limits: "Decline retention offers unless it's free for 3+ months. No cancellation fee without asking me." },
  { id: "dispute", label: "Dispute a charge", icon: "receipt", category: "billing", goal: "Dispute the unexpected charge on my latest bill and get it refunded or credited.", limits: "Accept a full credit. Ask me before accepting a partial credit." },
  { id: "order", label: "Check order status", icon: "store", category: "general", goal: "Find out the status of my most recent order: where it is, the expected delivery date, and the tracking number.", limits: "Don't cancel or change the order." },
  { id: "table", label: "Book a table", icon: "utensils", category: "reservation", goal: "", limits: "Any time within 1 hour of the requested time is fine.", who: "other" },
  { id: "appt", label: "Book an appointment", icon: "cal", category: "general", goal: "Book the earliest appointment that fits my calendar, and confirm the date, time and address.", limits: "Weekdays 9 AM–5 PM unless my calendar shows otherwise. Ask me before paying a deposit.", who: "other" },
  { id: "human", label: "Get me a human", icon: "headphones", category: "service", goal: "Get through the phone menu and hold, then connect me to a person.", limits: "", holdForMe: true },
];
