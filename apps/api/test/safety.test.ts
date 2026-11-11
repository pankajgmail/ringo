import { describe, expect, it } from "vitest";
import { checkDialable } from "../src/lib/safety.ts";
import { forwardingCodes, OutCallInputSchema } from "@ringo/shared";

describe("checkDialable", () => {
  it.each(["+18002882020", "+14158675309"])("allows %s", (n) => expect(checkDialable(n)).toBeNull());
  it.each(["+1911", "911", "+1988", "+19005551234", "+442071234567", "+14155550142"])("blocks %s", (n) => expect(checkDialable(n)).not.toBeNull());
});

describe("forwardingCodes", () => {
  it("builds GSM codes with a 30s no-answer timer", () => {
    expect(forwardingCodes("att", "+14155550142")).toMatchObject({ noAnswer: "**61*+14155550142*11*30#", busy: "**67*+14155550142#", disable: "##61#" });
  });
  it("uses *71 for Verizon", () => expect(forwardingCodes("verizon", "+14155550142").noAnswer).toBe("*714155550142"));
});

describe("OutCallInputSchema", () => {
  const base = { providerId: "att", category: "billing", goal: "Waive the $35 late fee." };
  it("applies defaults", () => expect(OutCallInputSchema.parse(base)).toMatchObject({ priority: "medium", askMe: "ask", limits: "" }));
  it("requires number for custom providers", () => expect(() => OutCallInputSchema.parse({ ...base, providerId: "custom", name: "Nopa" })).toThrow());
  it("requires reservation details for bookings", () => expect(() => OutCallInputSchema.parse({ ...base, category: "reservation" })).toThrow());
});
