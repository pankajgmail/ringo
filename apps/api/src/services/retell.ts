import Retell from "retell-sdk";
import { env } from "../env.ts";

export const retellConfigured = !!env.RETELL_API_KEY;
// The SDK throws on an empty key, so use a dummy one until Retell is configured; nothing calls it then.
export const retell = new Retell({ apiKey: env.RETELL_API_KEY || "not-configured" });

/** Retell signs webhooks and custom-tool calls with the API key over the exact raw body. */
export function verifyRetell(rawBody: string, signature: string | undefined) {
  if (!signature || !retellConfigured) return Promise.resolve(false);
  return Retell.verify(rawBody, env.RETELL_API_KEY, signature);
}
