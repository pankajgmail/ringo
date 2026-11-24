import { useCallback } from "react";
import type { Answer, Feedback, InCall, InfoMode, OutCall, OutCallInput, Profile, TranscriptLine, forwardingCodes } from "@ringo/shared";
import { config, devAuth } from "./config.ts";
import { useAuth } from "./auth.tsx";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Me = Profile & {
  id: string; isAdmin: boolean; numbersAvailable: boolean; phoneVerified: boolean; ringoNumber: string | null; forwardingActive: boolean; monthlyBudgetCents: number; infoMode: InfoMode;
  messaging: { sms: boolean; whatsapp: boolean; whatsappNumber: string | null; whatsappJoin: string | null };
  calendar: { available: boolean; connected: boolean; email: string | null; check: boolean; save: boolean };
  forwarding: ReturnType<typeof forwardingCodes> | null;
};

export type AdminStats = {
  feedback: { total: number; average: number | null; stars: number[]; recent: { id: string; rating: number; comment: string | null; platform: string | null; at: string; name: string; email: string }[] };
  signups: { total: number; last7d: number; verified: number };
  users: { id: string; name: string; email: string; joinedAt: string; phoneVerified: boolean; outCalls: number; inCalls: number }[];
  direction: { out: number; in: number };
  outcomes: { completed: number; upcoming: number; live: number; failed: number; cancelled: number };
};

/** Business search result. kind "service" = a national brand's customer-service line. */
export type Savings = { savedCents: number; monthSavedCents: number; holdSec: number; talkSec: number; done: number; inCalls: number };
export type Prefs = { infoMode?: InfoMode; calendarCheck?: boolean; calendarSave?: boolean };

export type Billing = {
  available: boolean; subscribed: boolean; status: string | null; renewsAt: string | null; cancelAtPeriodEnd: boolean;
  freeCalls: number; freeLeft: number; priceCents: number;
};

export type PlaceHit = { id: string; name: string; number: string; address: string; kind: "service" | "place"; providerId?: string; openNow?: boolean };

export function useApi() {
  const { getToken, signOut } = useAuth();

  const req = useCallback(async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (devAuth) headers["x-dev-user"] = config.devUser;
    else {
      const token = await getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError(0, "Can't reach Ringo. Check your connection.");
    }
    if (res.status === 401) {
      await signOut();
      throw new ApiError(401, "Please sign in again");
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (data as { error?: string; issues?: { message: string }[] } | null);
      throw new ApiError(res.status, msg?.issues?.[0]?.message ?? msg?.error ?? `Request failed (${res.status})`);
    }
    return data as T;
  }, [getToken, signOut]);

  return {
    me: () => req<Me>("GET", "/v1/me"),
    saveProfile: (p: Profile) => req<{ ok: true; phoneVerified: boolean }>("PUT", "/v1/me", p),
    startPhoneVerify: (phone: string) => req("POST", "/v1/me/phone/verify", { phone }),
    checkPhoneVerify: (phone: string, code: string) => req("POST", "/v1/me/phone/check", { phone, code }),
    setInfoMode: (infoMode: InfoMode) => req<{ ok: true; infoMode: InfoMode }>("PUT", "/v1/me/preferences", { infoMode }),
    setPrefs: (p: Prefs) => req<{ ok: true } & Prefs>("PUT", "/v1/me/preferences", p),
    connectCalendar: (returnTo: string) => req<{ url: string }>("POST", "/v1/calendar/connect", { returnTo }),
    disconnectCalendar: () => req("DELETE", "/v1/calendar"),
    savings: () => req<Savings>("GET", "/v1/savings"),
    repeatCall: (id: string, scheduledAt?: string) => req<OutCall>("POST", `/v1/calls/${id}/repeat`, scheduledAt ? { scheduledAt } : {}),
    callBack: (inCallId: string) => req<OutCall>("POST", `/v1/in-calls/${inCallId}/callback`, {}),
    billing: () => req<Billing>("GET", "/v1/billing"),
    sendFeedback: (f: Feedback) => req<{ ok: true }>("POST", "/v1/feedback", f),
    checkout: (returnTo: string) => req<{ url: string }>("POST", "/v1/billing/checkout", { returnTo }),
    billingPortal: (returnTo: string) => req<{ url: string }>("POST", "/v1/billing/portal", { returnTo }),
    getNumber: () => req<{ ringoNumber: string }>("POST", "/v1/me/number"),
    setForwarding: (active: boolean) => req("PUT", "/v1/me/forwarding", { active }),
    deleteMe: () => req("DELETE", "/v1/me"),
    calls: (status: "upcoming" | "history") => req<OutCall[]>("GET", `/v1/calls?status=${status}`),
    call: (id: string) => req<OutCall & { transcript: TranscriptLine[] }>("GET", `/v1/calls/${id}`),
    createCall: (c: OutCallInput) => req<OutCall>("POST", "/v1/calls", c),
    cancelCall: (id: string) => req("POST", `/v1/calls/${id}/cancel`),
    answer: (callId: string, askId: string, a: Answer) => req("POST", `/v1/calls/${callId}/asks/${askId}`, a),
    places: (q: string, near?: string) =>
      req<{ configured: boolean; results: PlaceHit[] }>("GET", `/v1/places?q=${encodeURIComponent(q)}${near ? `&near=${encodeURIComponent(near)}` : ""}`),
    inCalls: () => req<InCall[]>("GET", "/v1/in-calls"),
    adminStats: () => req<AdminStats>("GET", "/v1/admin/stats"),
    registerPush: (token: string, platform: "ios" | "android" | "web") => req("POST", "/v1/push-tokens", { token, platform }),
  };
}
