import { describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
  DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
});
vi.mock("../src/db/client.ts", () => ({ schema: {}, db: {} }));
vi.mock("../src/services/retell.ts", () => ({ verifyRetell: async () => true, retell: {} }));
vi.mock("../src/services/live.ts", () => ({ isOnline: () => true, publish: vi.fn(), push: vi.fn() }));
vi.mock("../src/services/serialize.ts", () => ({ toOutCall: (r: unknown) => r }));
vi.mock("../src/lib/audit.ts", () => ({ audit: vi.fn() }));
vi.mock("../src/jobs/dialer.ts", () => ({ finish: vi.fn(), maybeRedial: vi.fn() }));

const { zoned, parseLocal, today } = await import("../src/lib/tz.ts");
const { callFacts } = await import("../src/routes/retell.ts");

const LA = "America/Los_Angeles";
const nextYear = new Date().getFullYear() + 1;

describe("tz", () => {
  it("turns a local wall-clock time into the right instant, across DST", () => {
    expect(zoned("2026-07-01", "19:00", LA).toISOString()).toBe("2026-07-02T02:00:00.000Z"); // PDT, UTC-7
    expect(zoned("2026-12-01", "19:00", LA).toISOString()).toBe("2026-12-02T03:00:00.000Z"); // PST, UTC-8
    expect(zoned("2026-12-01", "09:30", "Asia/Kolkata").toISOString()).toBe("2026-12-01T04:00:00.000Z");
  });

  it("gives today's date in the user's zone, not the server's", () => {
    const at = new Date("2026-11-24T05:00:00Z"); // 9pm on the 23rd in LA
    expect(today(LA, at).iso).toBe("2026-11-23");
    expect(today("UTC", at).iso).toBe("2026-11-24");
  });

  it("parses analysis dates, defaults the time, and rejects junk", () => {
    expect(parseLocal(`${nextYear}-03-04 14:15`, LA)?.toISOString()).toBe(zoned(`${nextYear}-03-04`, "14:15", LA).toISOString());
    expect(parseLocal(`${nextYear}-03-04`, LA, "10:00")?.toISOString()).toBe(zoned(`${nextYear}-03-04`, "10:00", LA).toISOString());
    expect(parseLocal("next Tuesday", LA)).toBeNull();
    expect(parseLocal("", LA)).toBeNull();
    expect(parseLocal(undefined, LA)).toBeNull();
  });
});

describe("callFacts", () => {
  const row = (over: Record<string, unknown> = {}) => ({ category: "billing", reservation: null, ...over }) as never;

  it("records money saved only on a successful call, in cents, within sane bounds", () => {
    expect(callFacts(row(), { saved_amount: 12.5 }, "success", LA).savedCents).toBe(1250);
    expect(callFacts(row(), { saved_amount: "30" }, "partial", LA).savedCents).toBe(3000);
    expect(callFacts(row(), { saved_amount: 12.5 }, "failed", LA).savedCents).toBeNull();
    expect(callFacts(row(), { saved_amount: 0 }, "success", LA).savedCents).toBeNull();
    expect(callFacts(row(), { saved_amount: 5_000_000 }, "success", LA).savedCents).toBeNull();
    expect(callFacts(row(), { saved_amount: "lots" }, "success", LA).savedCents).toBeNull();
  });

  it("keeps a future follow-up date and its reason, even on a failed call", () => {
    const f = callFacts(row(), { follow_up_date: `${nextYear}-01-15`, follow_up_reason: "Credit should post by then" }, "failed", LA);
    expect(f.followUpAt?.toISOString()).toBe(zoned(`${nextYear}-01-15`, "10:00", LA).toISOString());
    expect(f.followUpNote).toBe("Credit should post by then");
  });

  it("takes the appointment time from analysis, or falls back to the reservation", () => {
    expect(callFacts(row(), { appointment_time: `${nextYear}-02-02 08:30` }, "success", LA).appointmentAt?.toISOString())
      .toBe(zoned(`${nextYear}-02-02`, "08:30", LA).toISOString());
    const res = row({ category: "reservation", reservation: { date: `${nextYear}-05-05`, time: "19:30", party: 4 } });
    expect(callFacts(res, {}, "success", LA).appointmentAt?.toISOString()).toBe(zoned(`${nextYear}-05-05`, "19:30", LA).toISOString());
    expect(callFacts(res, {}, "failed", LA).appointmentAt).toBeNull();
  });
});
