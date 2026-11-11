/**
 * Creates or updates Ringo's Retell LLMs + agents, and (optionally) imports a Twilio number.
 *   npm run retell:setup                     # agents only
 *   npm run retell:setup -- --import +14155550142   # also attach this Twilio number via the SIP trunk
 * Prints the agent IDs to put in .env / Secrets Manager. Safe to re-run: matches existing agents by name.
 */
import { retell } from "../src/services/retell.ts";
import { env } from "../src/env.ts";
import { BOOKING_PROMPT, INBOUND_PROMPT, OUTBOUND_PROMPT } from "../../../retell/prompts.ts";

const base = env.PUBLIC_URL.replace(/\/$/, "");
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
const getAccount = tool("get_account", "Get the account number, holder name and PIN for the provider being called.", {}, []);
const askUser = tool("ask_user", "Ask the account holder a question in real time and wait up to 90 seconds for their answer.", {
  question: { type: "string", description: "One short sentence the user will see on their phone." },
  kind: { type: "string", enum: ["decision", "code"], description: "'code' when you need a one-time code they received by text." },
}, ["question"], 120_000);

const endCall = { type: "end_call" as const, name: "end_call", description: "End the call when the goal is done or cannot be done." };
const pressDigit = { type: "press_digit" as const, name: "press_digit", description: "Press keypad digits to navigate phone menus." };

const outcomeFields = [
  { type: "enum" as const, name: "outcome", description: "success = goal fully met; partial = some of it; failed = nothing achieved.", choices: ["success", "partial", "failed"] },
  { type: "string" as const, name: "result_summary", description: "One or two plain sentences for the user: what was agreed, amounts, dates." },
  { type: "string" as const, name: "reference_number", description: "Reference, ticket or confirmation number, or empty." },
];
const inboundFields = [
  { type: "enum" as const, name: "caller_type", description: "important = time-sensitive or from a doctor, school, bank, courier, employer; message = normal; spam = sales/robocall.", choices: ["important", "message", "spam"] },
  { type: "string" as const, name: "caller_name", description: "Caller's name and organization." },
  { type: "string" as const, name: "message", description: "The message in one or two sentences, including best callback time." },
  { type: "string" as const, name: "callback_number", description: "Callback number in E.164 if given, else empty." },
];

async function upsert(name: string, prompt: string, tools: unknown[], analysis: unknown[], extra: Record<string, unknown> = {}) {
  const match = (await retell.agent.list({ limit: 1000 })).items.find((a) => a.agent_name === name);
  const existing = match ? await retell.agent.retrieve(match.agent_id) : undefined;
  const llmBody = { model: MODEL, general_prompt: prompt, general_tools: tools as never, start_speaker: "user" as const };
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

const outbound = await upsert("ringo-outbound", OUTBOUND_PROMPT, [reportStatus, getAccount, askUser, pressDigit, endCall], outcomeFields);
const booking = await upsert("ringo-booking", BOOKING_PROMPT, [askUser, pressDigit, endCall], outcomeFields);
const inbound = await upsert("ringo-inbound", INBOUND_PROMPT, [endCall], inboundFields, { end_call_after_silence_ms: 20_000 });

console.log(`RETELL_OUTBOUND_AGENT_ID=${outbound}\nRETELL_BOOKING_AGENT_ID=${booking}\nRETELL_INBOUND_AGENT_ID=${inbound}`);

const i = process.argv.indexOf("--import");
const number = i > 0 ? process.argv[i + 1] : undefined;
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
