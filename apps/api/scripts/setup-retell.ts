/**
 * Creates or updates RingVo's Retell LLMs + agents, and (optionally) imports a Twilio number.
 *   npm run retell:setup                     # agents only
 *   npm run retell:setup -- --import +14155550142   # also attach this Twilio number via the SIP trunk
 * Prints the agent IDs to put in .env / Secrets Manager. Safe to re-run: matches existing agents by name.
 */
import { retell } from "../src/services/retell.ts";
import { env } from "../src/env.ts";
import { BOOKING_PROMPT, INBOUND_PROMPT, OUTBOUND_PROMPT } from "../../../retell/prompts.ts";

const base = env.PUBLIC_URL.replace(/\/$/, "");
// Retell sends call details and transcripts to these URLs, so they must be HTTPS.
if (!base.startsWith("https://")) throw new Error(`PUBLIC_URL must be https:// (got ${base}). Use the CloudFront URL or the API domain.`);
const MODEL = "gpt-5.4-mini" as const;
const VOICE = "11labs-Adrian";

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[], timeout_ms = 10_000) => ({
  type: "custom" as const,
  name,
  description,
  url: `${base}/retell/tools/${name}`,
  method: "POST" as const,
  timeout_ms,
  speak_during_execution: false,
  speak_after_execution: true,
  parameters: { type: "object" as const, properties, required },
});

const reportStatus = tool("report_status", "Report call progress so the user can follow along.", {
  stage: { type: "string", enum: ["menu", "hold", "talk"] },
  note: { type: "string", description: "Short note, e.g. 'Pressed 2 for billing'" },
}, ["stage"]);
const askUser = tool("ask_user", "Ask the account holder something in real time: approve an offer, read you a texted code, or give information you don't have (account number, PIN, party size). Waits up to 50 seconds; if they need longer the result says to call wait_for_answer.", {
  question: { type: "string", description: "One short sentence the user will see on their phone, e.g. 'What is your Verizon account PIN?'" },
  kind: { type: "string", enum: ["decision", "code", "info"], description: "'decision' for an offer; 'code' for a one-time code they received by text; 'info' for any other detail you don't have." },
}, ["question"], 58_000);
const waitForAnswer = tool("wait_for_answer", "Keep waiting for the account holder's answer to the last ask_user question. Only call this when a tool result tells you to.", {
  ask_id: { type: "string", description: "The ask_id from the previous result." },
}, [], 58_000);

// Warm transfer to the account holder's own phone. RingVo stays with the rep while it rings (90s, Retell's maximum,
// which keeps the whole wait inside the 2-minute limit),
// briefs the account holder privately, then connects them. If they don't pick up the agent gets the call back.
const conferenceUser = {
  type: "transfer_call" as const,
  name: "conference_user",
  description: "Connect the account holder to this call so they can give the rep information themselves. Only call this when a tool result tells you to.",
  transfer_destination: { type: "predefined" as const, number: "{{user_phone}}" },
  transfer_option: {
    type: "warm_transfer" as const,
    transfer_ring_duration_ms: 90_000,
    on_hold_music: "none" as const,
    private_handoff_option: { type: "prompt" as const, prompt: "Tell {{user_name}} in one or two sentences who you are on the line with ({{provider_name}}) and exactly what the rep needs from them, then say you're connecting them now." },
  },
  speak_during_execution: true,
  execution_message_description: "Tell the rep you're bringing the account holder on the line and to please hold.",
};

const checkCalendar = tool("check_calendar", "See when the account holder is busy on a date (times only), and whether a proposed time is free. Only works when calendar_access is yes.", {
  date: { type: "string", description: "Date to check, YYYY-MM-DD." },
  time: { type: "string", description: "Proposed start time, 24-hour HH:MM, if there is one." },
  minutes: { type: "number", description: "How long it lasts, in minutes. Default 60." },
}, ["date"]);

const endCall = { type: "end_call" as const, name: "end_call", description: "End the call when the goal is done or cannot be done." };
const pressDigit = { type: "press_digit" as const, name: "press_digit", description: "Press keypad digits to navigate phone menus." };

const outcomeFields = [
  { type: "enum" as const, name: "outcome", description: "success = goal fully met; partial = some of it; failed = nothing achieved.", choices: ["success", "partial", "failed"] },
  { type: "string" as const, name: "result_summary", description: "Two or three plain sentences for the user: what was asked, what the rep said, what was agreed (amounts, dates), any information the account holder supplied or whether they joined the call, and what happens next. Never include account numbers, PINs or codes." },
  { type: "string" as const, name: "reference_number", description: "Reference, ticket or confirmation number, or empty." },
  { type: "number" as const, name: "saved_amount", description: "US dollars the account holder saves because of this call: credits, refunds, waived fees, or for a lower monthly bill the monthly saving times 12. 0 if none." },
  { type: "string" as const, name: "appointment_time", description: "If a booking, appointment, visit or delivery window was confirmed: its start as YYYY-MM-DD HH:MM (24-hour, the business's local time). Else empty." },
  { type: "string" as const, name: "follow_up_date", description: "If the rep said to call back or that something will happen by a date (e.g. 'call back in 3 days', 'refund in 7–10 days'): that date as YYYY-MM-DD, counting from today ({{today}}). Else empty." },
  { type: "string" as const, name: "follow_up_reason", description: "Short reason for the follow-up, e.g. 'check the refund posted'. Else empty." },
];
const inboundFields = [
  { type: "enum" as const, name: "caller_type", description: "important = time-sensitive or from a doctor, school, bank, courier, employer; message = normal; sales = a real person pitching an offer, promotion or service; spam = robocall, recording, scam, warranty or survey.", choices: ["important", "message", "sales", "spam"] },
  { type: "string" as const, name: "caller_name", description: "Caller's name and organization." },
  { type: "string" as const, name: "message", description: "Summary of the conversation in two or three sentences: who called, why, any details they gave, and the best callback time." },
  { type: "string" as const, name: "callback_number", description: "Callback number in E.164 if given, else empty." },
  { type: "string" as const, name: "offer_value", description: "Sales calls only: what's being offered and the value or benefit to the user, in one sentence. Else empty." },
  { type: "string" as const, name: "offer_price", description: "Sales calls only: what the user would pay (price, fees, contract length), as stated. 'Not stated' if they wouldn't say. Else empty." },
  { type: "string" as const, name: "offer_deadline", description: "Sales calls only: any deal or deadline ending soon and the date to apply by. 'None' if there isn't one. Else empty." },
];

async function upsert(name: string, prompt: string, tools: unknown[], analysis: unknown[], extra: Record<string, unknown> = {}) {
  const match = (await retell.agent.list({ limit: 1000 })).items.find((a) => a.agent_name === name);
  const existing = match ? await retell.agent.retrieve(match.agent_id) : undefined;
  const llmBody = { model_config: { type: "cascading" as const, primary: { model: MODEL, tier: "standard" as const } }, general_prompt: prompt, general_tools: tools as never, start_speaker: "user" as const };
  const agentBody = {
    agent_name: name,
    voice_id: VOICE,
    language: "en-US" as const,
    webhook_url: `${base}/retell/webhook`,
    webhook_events: ["call_started", "call_ended", "call_analyzed", "transcript_updated"] as ("call_started" | "call_ended" | "call_analyzed" | "transcript_updated")[],
    max_call_duration_ms: env.MAX_CALL_MINUTES * 60_000,
    // Long holds are silent; don't hang up on them.
    end_call_after_silence_ms: 30 * 60_000,
    post_call_analysis_data: analysis as never,
    data_storage_setting: "everything_except_pii" as const,
    ...extra,
  };
  if (existing && existing.response_engine.type === "retell-llm") {
    await retell.llm.update(existing.response_engine.llm_id, llmBody);
    await retell.agent.update(existing.agent_id, agentBody);
    return existing.agent_id;
  }
  const llm = await retell.llm.create(llmBody);
  const agent = await retell.agent.create({ ...agentBody, response_engine: { type: "retell-llm", llm_id: llm.llm_id } });
  return agent.agent_id;
}

const outbound = await upsert("ringo-outbound", OUTBOUND_PROMPT, [reportStatus, askUser, waitForAnswer, conferenceUser, checkCalendar, pressDigit, endCall], outcomeFields);
const booking = await upsert("ringo-booking", BOOKING_PROMPT, [reportStatus, askUser, waitForAnswer, conferenceUser, checkCalendar, pressDigit, endCall], outcomeFields);
const inbound = await upsert("ringo-inbound", INBOUND_PROMPT, [endCall], inboundFields, { end_call_after_silence_ms: 20_000 });

console.log(`RETELL_OUTBOUND_AGENT_ID=${outbound}\nRETELL_BOOKING_AGENT_ID=${booking}\nRETELL_INBOUND_AGENT_ID=${inbound}`);

const i = process.argv.indexOf("--import");
const number = i > 0 ? process.argv[i + 1] : undefined;
// --update +1…: re-point an already imported number at the current agents and webhook URL.
const u = process.argv.indexOf("--update");
const existingNumber = u > 0 ? process.argv[u + 1] : undefined;
if (existingNumber) {
  await retell.phoneNumber.update(existingNumber, {
    inbound_agents: [{ agent_id: inbound, weight: 1 }],
    outbound_agents: [{ agent_id: outbound, weight: 1 }],
    inbound_webhook_url: `${base}/retell/inbound`,
  });
  console.log(`Updated ${existingNumber} in Retell`);
}
if (number) {
  if (!env.TWILIO_TERMINATION_URI) throw new Error("Set TWILIO_TERMINATION_URI (see docs/setup.md, Twilio SIP trunk)");
  await retell.phoneNumber.import({
    phone_number: number,
    termination_uri: env.TWILIO_TERMINATION_URI,
    sip_trunk_auth_username: env.TWILIO_SIP_USERNAME || undefined,
    sip_trunk_auth_password: env.TWILIO_SIP_PASSWORD || undefined,
    inbound_agents: [{ agent_id: inbound, weight: 1 }],
    outbound_agents: [{ agent_id: outbound, weight: 1 }],
    inbound_webhook_url: `${base}/retell/inbound`,
    nickname: "ringo",
  });
  console.log(`Imported ${number} into Retell`);
}
