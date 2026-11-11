import { useCallback } from "react";
import type { Account, AccountInput, Answer, InCall, OutCall, OutCallInput, Profile, TranscriptLine, forwardingCodes } from "@ringo/shared";
import { config, devAuth } from "./config.ts";
import { useAuth } from "./auth.tsx";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Me = Profile & {
  id: string; phoneVerified: boolean; ringoNumber: string | null; forwardingActive: boolean; monthlyBudgetCents: number;
  forwarding: ReturnType<typeof forwardingCodes> | null;
};

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
    setForwarding: (active: boolean) => req("PUT", "/v1/me/forwarding", { active }),
    deleteMe: () => req("DELETE", "/v1/me"),
    accounts: () => req<Account[]>("GET", "/v1/accounts"),
    saveAccount: (a: AccountInput) => req("PUT", "/v1/accounts", a),
    deleteAccount: (id: string) => req("DELETE", `/v1/accounts/${id}`),
    calls: (status: "upcoming" | "history") => req<OutCall[]>("GET", `/v1/calls?status=${status}`),
    call: (id: string) => req<OutCall & { transcript: TranscriptLine[] }>("GET", `/v1/calls/${id}`),
    createCall: (c: OutCallInput) => req<OutCall>("POST", "/v1/calls", c),
    cancelCall: (id: string) => req("POST", `/v1/calls/${id}/cancel`),
    answer: (callId: string, askId: string, a: Answer) => req("POST", `/v1/calls/${callId}/asks/${askId}`, a),
    inCalls: () => req<InCall[]>("GET", "/v1/in-calls"),
    registerPush: (token: string, platform: "ios" | "android" | "web") => req("POST", "/v1/push-tokens", { token, platform }),
  };
}
