import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

let encrypt: typeof import("../src/lib/crypto.ts").encrypt;
let decrypt: typeof import("../src/lib/crypto.ts").decrypt;

beforeAll(async () => {
  Object.assign(process.env, {
    PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
    DEV_ENCRYPTION_KEY: randomBytes(32).toString("base64"), KMS_KEY_ID: "",
  });
  ({ encrypt, decrypt } = await import("../src/lib/crypto.ts"));
});

describe("envelope encryption", () => {
  it("round-trips", async () => {
    const blob = await encrypt("287654321098", { userId: "u1", field: "account" });
    expect(blob.toString("utf8")).not.toContain("287654321098");
    expect(await decrypt(blob, { userId: "u1", field: "account" })).toBe("287654321098");
  });

  it("refuses a value moved to another user or field", async () => {
    const blob = await encrypt("1234", { userId: "u1", field: "pin" });
    await expect(decrypt(blob, { userId: "u2", field: "pin" })).rejects.toThrow();
    await expect(decrypt(blob, { userId: "u1", field: "account" })).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const blob = await encrypt("secret", { userId: "u1" });
    blob[blob.length - 1]! ^= 1;
    await expect(decrypt(blob, { userId: "u1" })).rejects.toThrow();
  });
});
