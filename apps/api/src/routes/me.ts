import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import twilio from "twilio";
import { ForwardingSchema, PreferencesSchema, PhoneVerifyCheckSchema, PhoneVerifyStartSchema, ProfileSchema, PushTokenSchema, forwardingCodes } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { deleteAccount } from "../lib/delete-account.ts";
import { isAdmin } from "./admin.ts";
import { NumberError, numbersConfigured, provisionNumber } from "../services/numbers.ts";

const verify = env.TWILIO_VERIFY_SERVICE_SID && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID) : null;

export async function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", async (req) => {
    const u = req.user;
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, phoneVerified: !!u.phoneVerifiedAt, address: u.address, zip: u.zip, isAdmin: isAdmin(u),
      carrier: u.carrier, timezone: u.timezone, ringoNumber: u.ringoNumber, forwardingActive: u.forwardingActive,
      monthlyBudgetCents: u.monthlyBudgetCents, numbersAvailable: numbersConfigured(), infoMode: u.infoMode,
      forwarding: u.ringoNumber ? forwardingCodes(u.carrier, u.ringoNumber) : null,
    };
  });

  app.put("/v1/me", async (req) => {
    const p = ProfileSchema.parse(req.body);
    // Changing phone clears verification; forwarding and caller context depend on it.
    const phoneChanged = p.phone !== req.user.phone;
    await db.update(schema.users).set({ ...p, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) }).where(eq(schema.users.id, req.user.id));
    return { ok: true, phoneVerified: phoneChanged ? false : !!req.user.phoneVerifiedAt };
  });

  /** How Ringo gets details it doesn't have mid-call: ask in the app, or conference the user in. */
  app.put("/v1/me/preferences", async (req) => {
    const p = PreferencesSchema.parse(req.body);
    await db.update(schema.users).set(p).where(eq(schema.users.id, req.user.id));
    await audit(req.user.id, "me.preferences", p);
    return { ok: true, ...p };
  });

  app.post("/v1/me/phone/verify", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { phone } = PhoneVerifyStartSchema.parse(req.body);
    if (!verify) return reply.code(501).send({ error: "Phone verification is not configured" });
    await verify.verifications.create({ to: phone, channel: "sms" });
    return { ok: true };
  });

  app.post("/v1/me/phone/check", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { phone, code } = PhoneVerifyCheckSchema.parse(req.body);
    if (!verify) return reply.code(501).send({ error: "Phone verification is not configured" });
    const r = await verify.verificationChecks.create({ to: phone, code });
    if (r.status !== "approved") return reply.code(400).send({ error: "Code didn't match" });
    await db.update(schema.users).set({ phone, phoneVerifiedAt: new Date() }).where(eq(schema.users.id, req.user.id));
    await audit(req.user.id, "phone.verified", { phone });
    return { ok: true };
  });

  /** "Get your assistant number": buys a local number for this user the first time they open Forwarding. */
  app.post("/v1/me/number", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    try {
      return { ringoNumber: await provisionNumber(req.user) };
    } catch (e) {
      if (e instanceof NumberError) return reply.code(e.statusCode).send({ error: e.message });
      req.log.error({ err: e }, "[numbers] provisioning failed");
      return reply.code(502).send({ error: "Couldn't set up your number. Please try again in a few minutes." });
    }
  });

  app.put("/v1/me/forwarding", async (req) => {
    const { active } = ForwardingSchema.parse(req.body);
    await db.update(schema.users).set({ forwardingActive: active }).where(eq(schema.users.id, req.user.id));
    return { ok: true };
  });

  app.post("/v1/push-tokens", async (req) => {
    const t = PushTokenSchema.parse(req.body);
    await db.insert(schema.pushTokens).values({ userId: req.user.id, ...t }).onConflictDoUpdate({ target: schema.pushTokens.token, set: { userId: req.user.id, platform: t.platform } });
    return { ok: true };
  });

  /**
   * App Store guideline 5.1.1(v): in-app account deletion. Ends live calls, then deletes the user row
   * (calls, messages, questions and push tokens cascade) and the Cognito sign-in. Not a soft delete.
   */
  app.delete("/v1/me", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req) => {
    await deleteAccount(req.user);
    return { ok: true };
  });
}
