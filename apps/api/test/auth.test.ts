import { describe, expect, it } from "vitest";

Object.assign(process.env, {
  PUBLIC_URL: "https://example.test", DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
  DEV_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), KMS_KEY_ID: "",
});
const { isTrustedSignIn } = await import("../src/lib/auth.ts");

const google = { identities: [{ providerName: "Google" }], email: "pat@gmail.com", email_verified: true };

const apple = { identities: [{ providerName: "SignInWithApple" }], email: "x1@privaterelay.appleid.com" };

describe("isTrustedSignIn", () => {
  it("accepts Sign in with Apple, including private relay emails", () => {
    expect(isTrustedSignIn(apple)).toBe(true);
    expect(isTrustedSignIn({ ...apple, email_verified: "true" })).toBe(true);
    expect(isTrustedSignIn({ identities: apple.identities })).toBe(false);
  });
  it("accepts a verified Google user", () => {
    expect(isTrustedSignIn(google)).toBe(true);
    expect(isTrustedSignIn({ ...google, email_verified: "true" })).toBe(true);
  });
  it("rejects native Cognito (password) users", () => {
    expect(isTrustedSignIn({ email: "pat@gmail.com", email_verified: true })).toBe(false);
  });
  it("rejects other identity providers", () => {
    expect(isTrustedSignIn({ ...google, identities: [{ providerName: "Facebook" }] })).toBe(false);
  });
  it("rejects unverified or missing email", () => {
    expect(isTrustedSignIn({ ...google, email_verified: false })).toBe(false);
    expect(isTrustedSignIn({ identities: google.identities, email_verified: true })).toBe(false);
  });
});
