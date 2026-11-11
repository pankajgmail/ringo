import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
  DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
});
const { isGoogleSignIn } = await import("../src/lib/auth.ts");

const google = { identities: [{ providerName: "Google" }], email: "pat@gmail.com", email_verified: true };

describe("isGoogleSignIn", () => {
  it("accepts a verified Google user", () => {
    expect(isGoogleSignIn(google)).toBe(true);
    expect(isGoogleSignIn({ ...google, email_verified: "true" })).toBe(true);
  });
  it("rejects native Cognito (password) users", () => {
    expect(isGoogleSignIn({ email: "pat@gmail.com", email_verified: true })).toBe(false);
  });
  it("rejects other identity providers", () => {
    expect(isGoogleSignIn({ ...google, identities: [{ providerName: "Facebook" }] })).toBe(false);
  });
  it("rejects unverified or missing email", () => {
    expect(isGoogleSignIn({ ...google, email_verified: false })).toBe(false);
    expect(isGoogleSignIn({ identities: google.identities, email_verified: true })).toBe(false);
  });
});
