import twilio from "twilio";
import type { TextMode } from "@ringo/shared";
import { env } from "../env.ts";

// Mid-call questions by SMS or WhatsApp, so the user can answer without opening the app.
// Replies come back to /v1/webhooks/twilio/message (see routes/messages.ts).

const tw = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) : null;

const smsFrom = () => env.TWILIO_SMS_FROM || env.DEFAULT_FROM_NUMBER;
const waFrom = () => (env.TWILIO_WHATSAPP_FROM ? (env.TWILIO_WHATSAPP_FROM.startsWith("whatsapp:") ? env.TWILIO_WHATSAPP_FROM : `whatsapp:${env.TWILIO_WHATSAPP_FROM}`) : "");

export const textConfigured = (mode: TextMode) => !!tw && (mode === "sms" ? !!smsFrom() : !!waFrom());

/** What Settings shows: which channels work, and how to join the WhatsApp sandbox if that's the sender. */
export const messagingInfo = () => ({
  sms: textConfigured("sms"),
  whatsapp: textConfigured("whatsapp"),
  whatsappNumber: waFrom().replace(/^whatsapp:/, "") || null,
  whatsappJoin: env.TWILIO_WHATSAPP_JOIN || null,
});

/** Sends a text and returns its Twilio SID. Throws if Twilio refuses (unregistered sender, user not in the WhatsApp sandbox…). */
export async function sendText(mode: TextMode, to: string, body: string): Promise<string> {
  if (!tw || !textConfigured(mode)) throw new Error(`${mode} is not configured`);
  const m = await tw.messages.create(mode === "sms" ? { from: smsFrom(), to, body } : { from: waFrom(), to: `whatsapp:${to}`, body });
  return m.sid;
}

/** Deletes messages from Twilio's logs. Replies can hold PINs and account numbers; Ringo doesn't keep them. */
export async function forgetMessages(sids: string[]) {
  if (!tw) return;
  for (const sid of sids) {
    // Twilio can't delete a message that's still being delivered; one retry a few seconds later covers that.
    await tw.messages(sid).remove().catch(async () => {
      await new Promise((r) => setTimeout(r, 5000));
      await tw.messages(sid).remove().catch(() => undefined);
    });
  }
}

/** Checks a Twilio webhook signature, computed over the public URL Twilio called and the form fields. */
export function validTwilio(signature: string | undefined, url: string, params: Record<string, string>) {
  return !!signature && !!env.TWILIO_AUTH_TOKEN && twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}

/** Turns a texted reply into an answer. Decisions take a number or a word; anything else is free text. */
export function parseReply(kind: "decision" | "code" | "info", text: string): { choice: "accept" | "counter" | "takeover" | "end" | "reply"; note: string | null } {
  const t = text.trim();
  const w = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (/^(join|call me|connect me|takeover)$/.test(w) || (kind === "decision" && w === "3")) return { choice: "takeover", note: null };
  if (kind === "decision") {
    if (/^(1|yes|y|accept|ok|okay|sure)$/.test(w)) return { choice: "accept", note: null };
    if (/^(2|no|n|decline|counter)$/.test(w)) return { choice: "counter", note: null };
    if (/^(4|end|hang up|hangup)$/.test(w)) return { choice: "end", note: null };
    // Anything else on a decision is passed on as an instruction.
    return { choice: "reply", note: t.slice(0, 500) };
  }
  return { choice: "reply", note: t.slice(0, 500) };
}

/** The text Ringo sends. Kept short: it's read on a lock screen. */
export function questionText(kind: "decision" | "code" | "info", business: string, question: string) {
  return kind === "decision"
    ? `Ringo (${business}): ${question}\nReply 1 to accept, 2 to decline, 3 to join the call, 4 to end it.`
    : `Ringo (${business}): ${question}\nReply with the answer, or JOIN to be connected to the call. Ringo waits 2 minutes.`;
}
