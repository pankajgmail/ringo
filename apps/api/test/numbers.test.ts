import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
  DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
  TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_SIP_TRUNK_SID: "TK1", TWILIO_TERMINATION_URI: "x.pstn.twilio.com",
  RETELL_INBOUND_AGENT_ID: "agent_in", RETELL_OUTBOUND_AGENT_ID: "agent_out", MAX_RINGO_NUMBERS: "25",
});

// ---- fakes ----
const tw = {
  list: vi.fn(), create: vi.fn(), remove: vi.fn(),
};
vi.mock("twilio", () => ({
  default: () => ({
    availablePhoneNumbers: () => ({ local: { list: tw.list } }),
    incomingPhoneNumbers: Object.assign((sid: string) => ({ remove: () => tw.remove(sid) }), { create: tw.create }),
  }),
}));
const rt = { import: vi.fn(), delete: vi.fn() };
vi.mock("../src/services/retell.ts", () => ({ retellConfigured: true, retell: { phoneNumber: rt } }));
vi.mock("../src/lib/audit.ts", () => ({ audit: vi.fn() }));

let row: Record<string, unknown>;
let issued = 0;
const updates: Record<string, unknown>[] = [];
vi.mock("../src/db/client.ts", () => {
  const tx = {
    execute: vi.fn(),
    select: (fields?: unknown) => ({ from: () => ({ where: async () => (fields ? [{ n: issued }] : [row]) }) }),
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v); } }) }),
  };
  return { schema: { users: {} }, db: { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

const { provisionNumber } = await import("../src/services/numbers.ts");

const user = (over: Record<string, unknown> = {}) => ({ id: "u1", phone: "+14085074073", zip: "95014", phoneVerifiedAt: new Date(), ringoNumber: null, twilioNumberSid: null, ...over }) as never;

beforeEach(() => {
  vi.clearAllMocks(); updates.length = 0; issued = 0;
  row = user() as unknown as Record<string, unknown>;
  tw.list.mockResolvedValue([{ phoneNumber: "+14085550100" }]);
  tw.create.mockResolvedValue({ phoneNumber: "+14085550100", sid: "PN1" });
  rt.import.mockResolvedValue({});
  tw.remove.mockResolvedValue(true);
  rt.delete.mockResolvedValue(undefined);
});

describe("provisionNumber", () => {
  it("buys a local number on the trunk, imports it into Retell and saves it", async () => {
    await expect(provisionNumber(user())).resolves.toBe("+14085550100");
    expect(tw.list).toHaveBeenCalledWith(expect.objectContaining({ areaCode: 408, voiceEnabled: true }));
    expect(tw.create).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: "+14085550100", trunkSid: "TK1" }));
    expect(rt.import).toHaveBeenCalledWith(expect.objectContaining({
      phone_number: "+14085550100", inbound_agents: [{ agent_id: "agent_in", weight: 1 }], inbound_webhook_url: "https://example.test/retell/inbound",
    }));
    expect(updates).toEqual([{ ringoNumber: "+14085550100", twilioNumberSid: "PN1" }]);
  });

  it("falls back to the ZIP when the area code has nothing", async () => {
    tw.list.mockResolvedValueOnce([]).mockResolvedValueOnce([{ phoneNumber: "+16505550100" }]);
    tw.create.mockResolvedValue({ phoneNumber: "+16505550100", sid: "PN2" });
    await expect(provisionNumber(user())).resolves.toBe("+16505550100");
    expect(tw.list).toHaveBeenLastCalledWith(expect.objectContaining({ inPostalCode: "95014" }));
  });

  it("releases the Twilio number if Retell import fails", async () => {
    rt.import.mockRejectedValue(new Error("retell down"));
    await expect(provisionNumber(user())).rejects.toThrow("retell down");
    expect(tw.remove).toHaveBeenCalledWith("PN1");
    expect(updates).toEqual([]);
  });

  it("returns the existing number without buying", async () => {
    await expect(provisionNumber(user({ ringoNumber: "+18383682353" }))).resolves.toBe("+18383682353");
    row = user({ ringoNumber: "+18383682353" }) as unknown as Record<string, unknown>;
    await expect(provisionNumber(user())).resolves.toBe("+18383682353"); // a concurrent request already got one
    expect(tw.create).not.toHaveBeenCalled();
  });

  it("requires a verified phone", async () => {
    await expect(provisionNumber(user({ phoneVerifiedAt: null }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it("stops at the number cap", async () => {
    issued = 25;
    await expect(provisionNumber(user())).rejects.toMatchObject({ statusCode: 409 });
    expect(tw.create).not.toHaveBeenCalled();
  });
});
