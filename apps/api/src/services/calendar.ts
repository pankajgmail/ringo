import { eq } from "drizzle-orm";
import { db, schema } from "../db/client.ts";
import { env } from "../env.ts";
import { decrypt, encrypt } from "../lib/crypto.ts";
import { audit } from "../lib/audit.ts";
import type { User } from "../lib/auth.ts";

// Google Calendar, connected per user with OAuth (web server flow, offline access).
// Scopes are the narrowest that do the job: free/busy only (no event details), and creating events.
// The refresh token is envelope-encrypted with KMS and bound to the user id. Access tokens live in memory.

export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"];
export const calendarConfigured = () => !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
export const redirectUri = () => `${env.PUBLIC_URL.replace(/\/$/, "")}/v1/calendar/callback`;

export class CalendarError extends Error {}

type Linked = Pick<User, "id" | "googleRefreshToken">;
const ctx = (userId: string) => ({ userId, purpose: "google-calendar" });
const cache = new Map<string, { token: string; exp: number }>();

/** Where the app should send the user to grant access. `state` is encrypted so it can't be forged or read. */
export async function authUrl(userId: string, returnTo: string) {
  const state = (await encrypt(JSON.stringify({ u: userId, r: returnTo, exp: Date.now() + 10 * 60_000 }), { purpose: "gcal-state" })).toString("base64url");
  const q = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function readState(state: string): Promise<{ userId: string; returnTo: string }> {
  const s = JSON.parse(await decrypt(Buffer.from(state, "base64url"), { purpose: "gcal-state" })) as { u: string; r: string; exp: number };
  if (s.exp < Date.now()) throw new CalendarError("This link expired. Try connecting again.");
  return { userId: s.u, returnTo: s.r };
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string; error?: string };
  if (!res.ok || !data.access_token) throw new CalendarError(data.error === "invalid_grant" ? "revoked" : `Google token error ${res.status}`);
  return data;
}

/** Finishes the OAuth flow: stores the encrypted refresh token and the calendar's email. */
export async function connect(userId: string, code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const granted = (t.scope ?? "").split(" ");
  if (!granted.includes(SCOPES[2]!) && !granted.includes(SCOPES[3]!)) throw new CalendarError("Calendar access wasn't granted.");
  if (!t.refresh_token) throw new CalendarError("Google didn't return offline access. Remove Ringvo at myaccount.google.com/permissions and try again.");
  const email = t.id_token ? (JSON.parse(Buffer.from(t.id_token.split(".")[1]!, "base64url").toString()) as { email?: string }).email ?? null : null;
  await db.update(schema.users).set({
    googleRefreshToken: await encrypt(t.refresh_token, ctx(userId)), googleCalendarEmail: email,
    calendarCheck: granted.includes(SCOPES[2]!), calendarSave: granted.includes(SCOPES[3]!),
  }).where(eq(schema.users.id, userId));
  cache.set(userId, { token: t.access_token!, exp: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
  await audit(userId, "calendar.connected", { scopes: granted.filter((s) => s.includes("calendar")) });
  return email;
}

async function accessToken(u: Linked) {
  const hit = cache.get(u.id);
  if (hit && hit.exp > Date.now()) return hit.token;
  if (!u.googleRefreshToken) throw new CalendarError("not connected");
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: await decrypt(u.googleRefreshToken, ctx(u.id)) });
    cache.set(u.id, { token: t.access_token!, exp: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 });
    return t.access_token!;
  } catch (e) {
    // The user removed access in their Google account: forget the link so the app shows "Connect" again.
    if (e instanceof CalendarError && e.message === "revoked") await forget(u.id);
    throw e;
  }
}

async function forget(userId: string) {
  cache.delete(userId);
  await db.update(schema.users).set({ googleRefreshToken: null, googleCalendarEmail: null }).where(eq(schema.users.id, userId));
}

/** Revokes Ringvo's access at Google (best effort) and removes the stored token. */
export async function disconnect(u: Linked) {
  if (u.googleRefreshToken) {
    const rt = await decrypt(u.googleRefreshToken, ctx(u.id)).catch(() => null);
    if (rt) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: "POST" }).catch(() => undefined);
  }
  await forget(u.id);
  await audit(u.id, "calendar.disconnected");
}

async function google<T>(u: Linked, path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method: "POST", headers: { authorization: `Bearer ${await accessToken(u)}`, "content-type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new CalendarError(`Google Calendar ${res.status}`);
  return (await res.json()) as T;
}

/** Busy intervals on the primary calendar between two instants. Only times, never event titles. */
export async function busy(u: Linked, from: Date, to: Date): Promise<{ start: Date; end: Date }[]> {
  const r = await google<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(u, "/freeBusy", {
    timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }],
  });
  return (r.calendars?.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function addEvent(u: Linked, e: { title: string; start: Date; minutes: number; description: string; tz: string }) {
  const r = await google<{ id?: string }>(u, "/calendars/primary/events", {
    summary: e.title, description: e.description,
    start: { dateTime: e.start.toISOString(), timeZone: e.tz }, end: { dateTime: new Date(e.start.getTime() + e.minutes * 60_000).toISOString(), timeZone: e.tz },
    reminders: { useDefault: true }, source: { title: "Ringvo", url: env.PUBLIC_URL },
  });
  return r.id ?? null;
}
