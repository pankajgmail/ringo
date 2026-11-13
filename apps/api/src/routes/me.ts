import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import twilio from "twilio";
import { AccountInputSchema, PhoneVerifyCheckSchema, PhoneVerifyStartSchema, ProfileSchema, PushTokenSchema, forwardingCodes } from "@ringo/shared";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { audit } from "../lib/audit.ts";
import { encrypt } from "../lib/crypto.ts";

const verify = env.TWILIO_VERIFY_SERVICE_SID && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID) : null;

export async function meRoutes(app: FastifyInstance) {
  app.get("/v1/me", async (req) => {
    const u = req.user;
    return {
      id: u.id, name: u.name, email: u.email, phone: u.phone, phoneVerified: !!u.phoneVerifiedAt, address: u.address,
      carrier: u.carrier, timezone: u.timezone, ringoNumber: u.ringoNumber, forwardingActive: u.forwardingActive,
      monthlyBudgetCents: u.monthlyBudgetCents,
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

  app.put("/v1/me/forwarding", async (req) => {
    const { active } = req.body as { active: boolean };
    await db.update(schema.users).set({ forwardingActive: !!active }).where(eq(schema.users.id, req.user.id));
    return { ok: true };
  });

  app.get("/v1/accounts", async (req) => {
    const rows = await db.select().from(schema.accounts).where(eq(schema.accounts.userId, req.user.id));
    return rows.map((a) => ({ id: a.id, providerId: a.providerId, accountNumberLast4: a.accountNumberLast4, holderName: a.holderName, hasPin: !!a.pinEnc }));
  });

  app.put("/v1/accounts", async (req) => {
    const a = AccountInputSchema.parse(req.body);
    const ctx = { userId: req.user.id, field: "account" };
    const values = {
      userId: req.user.id,
      providerId: a.providerId,
      accountNumberEnc: await encrypt(a.accountNumber, ctx),
      accountNumberLast4: a.accountNumber.slice(-4),
      holderName: a.holderName ?? null,
      pinEnc: a.pin ? await encrypt(a.pin, { userId: req.user.id, field: "pin" }) : null,
    };
    await db.insert(schema.accounts).values(values).onConflictDoUpdate({ target: [schema.accounts.userId, schema.accounts.providerId], set: values });
    await audit(req.user.id, "account.saved", { providerId: a.providerId });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/v1/accounts/:id", async (req) => {
    await db.delete(schema.accounts).where(and(eq(schema.accounts.id, req.params.id), eq(schema.accounts.userId, req.user.id)));
    await audit(req.user.id, "account.deleted", { id: req.params.id });
    return { ok: true };
  });

  app.post("/v1/push-tokens", async (req) => {
    const t = PushTokenSchema.parse(req.body);
    await db.insert(schema.pushTokens).values({ userId: req.user.id, ...t }).onConflictDoUpdate({ target: schema.pushTokens.token, set: { userId: req.user.id, platform: t.platform } });
    return { ok: true };
  });

  /** App Store guideline 5.1.1(v): in-app account deletion. Soft-delete now; a nightly job purges data and releases the number. */
  app.delete("/v1/me", async (req) => {
    await db.update(schema.users).set({ deletedAt: new Date(), forwardingActive: false }).where(eq(schema.users.id, req.user.id));
    await db.delete(schema.accounts).where(eq(schema.accounts.userId, req.user.id));
    await db.delete(schema.pushTokens).where(eq(schema.pushTokens.userId, req.user.id));
    await audit(req.user.id, "user.deleted");
    return { ok: true };
  });
}
