import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
  STRIPE_SECRET_KEY: "sk_test_x", ADMIN_EMAILS: "boss@example.test",
});

let used = 0;
vi.mock("../src/db/client.ts", () => ({
  schema: { outCalls: {}, users: {} },
  db: { select: () => ({ from: () => ({ where: async () => [{ n: used }] }) }) },
}));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn(), isNotNull: vi.fn(), ne: vi.fn(), or: vi.fn(), sql: Object.assign(vi.fn(), {}) }));
vi.mock("../src/lib/audit.ts", () => ({ audit: vi.fn() }));
vi.mock("stripe", () => ({ default: class { } }));

const { assertCanCall, billingSummary, isSubscribed } = await import("../src/services/billing.ts");
const { parseReply } = await import("../src/services/messaging.ts");

const user = (over: Record<string, unknown> = {}) => ({ id: "u1", email: "me@example.test", subscriptionStatus: null, subscriptionPeriodEnd: null, subscriptionCancelAtPeriodEnd: false, ...over }) as never;

beforeEach(() => { used = 0; });

describe("free calls and subscription", () => {
  it("allows the first 5 calls, then asks for payment", async () => {
    used = 4;
    await expect(assertCanCall(user())).resolves.toBeUndefined();
    used = 5;
    await expect(assertCanCall(user())).rejects.toMatchObject({ statusCode: 402 });
  });

  it("doesn't limit subscribers (including past_due grace) or admins", async () => {
    used = 50;
    for (const status of ["active", "trialing", "past_due"]) await expect(assertCanCall(user({ subscriptionStatus: status }))).resolves.toBeUndefined();
    await expect(assertCanCall(user({ email: "Boss@example.test" }))).resolves.toBeUndefined();
  });

  it("stops calls once a subscription is cancelled or unpaid", async () => {
    used = 9;
    for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
      expect(isSubscribed(user({ subscriptionStatus: status }))).toBe(false);
      await expect(assertCanCall(user({ subscriptionStatus: status }))).rejects.toMatchObject({ statusCode: 402 });
    }
  });

  it("reports free calls left without going negative", async () => {
    used = 2;
    expect(await billingSummary(user())).toMatchObject({ available: true, subscribed: false, freeCalls: 5, freeLeft: 3, priceCents: 999 });
    used = 12;
    expect((await billingSummary(user())).freeLeft).toBe(0);
  });
});

describe("texted replies", () => {
  it("reads decisions from numbers or words", () => {
    expect(parseReply("decision", "1").choice).toBe("accept");
    expect(parseReply("decision", "Yes!").choice).toBe("accept");
    expect(parseReply("decision", "2").choice).toBe("counter");
    expect(parseReply("decision", "no").choice).toBe("counter");
    expect(parseReply("decision", "3").choice).toBe("takeover");
    expect(parseReply("decision", "4").choice).toBe("end");
    expect(parseReply("decision", "only if they waive the fee")).toEqual({ choice: "reply", note: "only if they waive the fee" });
  });

  it("passes info replies through as text, but JOIN connects the user", () => {
    expect(parseReply("info", " 4417 ")).toEqual({ choice: "reply", note: "4417" });
    expect(parseReply("code", "123456")).toEqual({ choice: "reply", note: "123456" });
    expect(parseReply("info", "1")).toEqual({ choice: "reply", note: "1" }); // a party size of 1, not "accept"
    expect(parseReply("info", "JOIN").choice).toBe("takeover");
    expect(parseReply("info", "call me").choice).toBe("takeover");
  });
});
