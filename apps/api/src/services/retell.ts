import Retell from "retell-sdk";
import { env } from "../env.ts";

export const retell = new Retell({ apiKey: env.RETELL_API_KEY });

/** Retell signs webhooks and custom-tool calls with the API key over the exact raw body. */
export function verifyRetell(rawBody: string, signature: string | undefined) {
  if (!signature) return Promise.resolve(false);
  return Retell.verify(rawBody, env.RETELL_API_KEY, signature);
}
