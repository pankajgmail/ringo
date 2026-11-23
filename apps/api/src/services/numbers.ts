import { and, eq, isNotNull, sql } from "drizzle-orm";
import twilio from "twilio";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import type { User } from "../lib/auth.ts";
import { audit } from "../lib/audit.ts";
import { retell, retellConfigured } from "./retell.ts";

// Each user's own "assistant number": a local Twilio number on the Ringo SIP trunk, imported into Retell.
// Calls the user forwards there reach the inbound agent, which knows whose line it is by the number dialled.

export class NumberError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const tw = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN) : null;

export const numbersConfigured = () =>
  !!(tw && retellConfigured && env.TWILIO_SIP_TRUNK_SID && env.TWILIO_TERMINATION_URI && env.RETELL_INBOUND_AGENT_ID && env.RETELL_OUTBOUND_AGENT_ID);

/** First available US local voice number: same area code as the user's mobile, then near their ZIP, then anywhere in the US. */
async function findNumber(user: User): Promise<string> {
  const local = tw!.availablePhoneNumbers("US").local;
  const area = user.phone?.match(/^\+1(\d{3})/)?.[1];
  const tries = [
    ...(area ? [{ areaCode: Number(area) }] : []),
    ...(user.zip ? [{ inPostalCode: user.zip }] : []),
    {},
  ];
  for (const t of tries) {
    const [hit] = await local.list({ ...t, voiceEnabled: true, excludeAllAddressRequired: true, limit: 1 }).catch(() => []);
    if (hit?.phoneNumber) return hit.phoneNumber;
  }
  throw new NumberError(503, "No phone numbers are available right now. Please try again later.");
}

/**
 * Gives the user their own number, once. Phone must be verified (numbers cost money, so no anonymous sign-ups).
 * A per-user advisory lock stops a double tap from buying two. If any step fails, what was bought is released.
 */
export async function provisionNumber(user: User): Promise<string> {
  if (user.ringoNumber) return user.ringoNumber;
  if (!user.phoneVerifiedAt) throw new NumberError(400, "Verify your mobile number in Settings first.");
  if (!numbersConfigured()) throw new NumberError(503, "Assistant numbers aren't switched on yet.");

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"ringo-number:" + user.id}))`);
    const [fresh] = await tx.select().from(schema.users).where(eq(schema.users.id, user.id));
    if (!fresh) throw new NumberError(404, "Account not found");
    if (fresh.ringoNumber) return fresh.ringoNumber;

    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.users)
      .where(and(isNotNull(schema.users.twilioNumberSid)));
    if (n >= env.MAX_RINGO_NUMBERS) throw new NumberError(409, "Ringo has handed out all the numbers it can for now. Please try again later.");

    const phoneNumber = await findNumber(fresh);
    const bought = await tw!.incomingPhoneNumbers.create({ phoneNumber, trunkSid: env.TWILIO_SIP_TRUNK_SID, friendlyName: `ringo ${fresh.id}` });
    let imported = false;
    try {
      await retell.phoneNumber.import({
        phone_number: bought.phoneNumber,
        termination_uri: env.TWILIO_TERMINATION_URI,
        sip_trunk_auth_username: env.TWILIO_SIP_USERNAME || undefined,
        sip_trunk_auth_password: env.TWILIO_SIP_PASSWORD || undefined,
        inbound_agents: [{ agent_id: env.RETELL_INBOUND_AGENT_ID, weight: 1 }],
        outbound_agents: [{ agent_id: env.RETELL_OUTBOUND_AGENT_ID, weight: 1 }],
        inbound_webhook_url: `${env.PUBLIC_URL}/retell/inbound`,
        nickname: `ringo ${fresh.id.slice(0, 8)}`,
      });
      imported = true;
      await tx.update(schema.users).set({ ringoNumber: bought.phoneNumber, twilioNumberSid: bought.sid }).where(eq(schema.users.id, fresh.id));
    } catch (e) {
      if (imported) await retell.phoneNumber.delete(bought.phoneNumber).catch(() => undefined);
      await tw!.incomingPhoneNumbers(bought.sid).remove().catch(() => undefined);
      throw e;
    }
    await audit(fresh.id, "number.provisioned", { number: bought.phoneNumber });
    return bought.phoneNumber;
  });
}

/** Releases a number Ringo bought for this user (Retell first, then Twilio). Shared or hand-linked numbers have no SID and are left alone. */
export async function releaseNumber(user: Pick<User, "id" | "ringoNumber" | "twilioNumberSid">) {
  if (!user.twilioNumberSid || !user.ringoNumber || !tw) return;
  if (retellConfigured) await retell.phoneNumber.delete(user.ringoNumber).catch(() => undefined);
  await tw.incomingPhoneNumbers(user.twilioNumberSid).remove().catch(() => undefined);
  await audit(null, "number.released", { number: user.ringoNumber });
}
