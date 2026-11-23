import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { config, devAuth } from "./config.ts";

WebBrowser.maybeCompleteAuthSession();

type Tokens = { idToken: string; refreshToken?: string; expiresAt: number };
export type Provider = "Google" | "SignInWithApple";
type Auth = {
  ready: boolean; signedIn: boolean; signIn: (provider?: Provider) => Promise<void>; signOut: () => Promise<void>; getToken: () => Promise<string | null>;
  completeWebSignIn: (code: string, state: string) => Promise<void>;
};

const KEY = "ringo.tokens";
const PENDING = "ringo.pendingSignIn"; // web only: PKCE verifier + state while the tab is away at Google
// iOS Keychain: readable only after the first unlock, on this device only (not in iCloud or backups).
const KEYCHAIN: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
// SecureStore is native-only. On web, tokens live in sessionStorage (cleared when the tab closes).
const store = {
  get: (): Promise<string | null> => (Platform.OS === "web" ? Promise.resolve(sessionStorage.getItem(KEY)) : SecureStore.getItemAsync(KEY, KEYCHAIN)),
  set: (v: string) => (Platform.OS === "web" ? Promise.resolve(sessionStorage.setItem(KEY, v)) : SecureStore.setItemAsync(KEY, v, KEYCHAIN)),
  del: () => (Platform.OS === "web" ? Promise.resolve(sessionStorage.removeItem(KEY)) : SecureStore.deleteItemAsync(KEY, KEYCHAIN)),
};

const discovery = config.cognitoDomain
  ? { authorizationEndpoint: `${config.cognitoDomain}/oauth2/authorize`, tokenEndpoint: `${config.cognitoDomain}/oauth2/token`, revocationEndpoint: `${config.cognitoDomain}/oauth2/revoke` }
  : null;
const redirectUri = AuthSession.makeRedirectUri({ scheme: "ringo", path: "auth" });

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    store.get().then((raw) => {
      try { if (raw) setTokens(JSON.parse(raw) as Tokens); } catch { void store.del(); }
      setReady(true);
    }, () => setReady(true));
  }, []);

  const save = useCallback(async (t: Tokens | null) => {
    setTokens(t);
    if (t) await store.set(JSON.stringify(t));
    else await store.del();
  }, []);

  const signIn = useCallback(async (provider: Provider = "Google") => {
    if (devAuth) return save({ idToken: "dev", expiresAt: Number.MAX_SAFE_INTEGER });
    // identity_provider skips Cognito's hosted page and goes straight to Google or Apple.
    const req = new AuthSession.AuthRequest({
      clientId: config.cognitoClientId, redirectUri, scopes: ["openid", "email", "profile"], usePKCE: true,
      extraParams: { identity_provider: provider, ...(provider === "Google" ? { prompt: "select_account" } : {}) },
    });
    // On web, Google's headers cut a popup off from this tab, so redirect the whole tab instead.
    // Cognito sends it back to /auth, which calls completeWebSignIn.
    if (Platform.OS === "web") {
      const url = await req.makeAuthUrlAsync(discovery!);
      sessionStorage.setItem(PENDING, JSON.stringify({ verifier: req.codeVerifier, state: req.state }));
      window.location.assign(url);
      return;
    }
    // Ephemeral session: no cookies shared with Safari, so the Google/Apple session doesn't linger on the device.
    const res = await req.promptAsync(discovery!, { preferEphemeralSession: true });
    if (res.type === "error") throw res.error ?? new Error("sign-in failed");
    if (res.type !== "success") return; // user cancelled
    const t = await AuthSession.exchangeCodeAsync(
      { clientId: config.cognitoClientId, code: res.params.code!, redirectUri, extraParams: { code_verifier: req.codeVerifier! } },
      discovery!,
    );
    await save({ idToken: t.idToken!, refreshToken: t.refreshToken, expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000 });
  }, [save]);

  const completeWebSignIn = useCallback(async (code: string, state: string) => {
    const raw = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING); // a code can only be exchanged once
    const pending = raw ? (JSON.parse(raw) as { verifier?: string; state?: string }) : null;
    if (!pending?.verifier || pending.state !== state) throw new Error("Sign-in expired. Please try again.");
    const t = await AuthSession.exchangeCodeAsync(
      { clientId: config.cognitoClientId, code, redirectUri, extraParams: { code_verifier: pending.verifier } },
      discovery!,
    );
    await save({ idToken: t.idToken!, refreshToken: t.refreshToken, expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000 });
  }, [save]);

  /** Revokes the refresh token at Cognito (so a copied token stops working), then forgets everything locally. */
  const signOut = useCallback(async () => {
    const rt = tokens?.refreshToken;
    await save(null);
    if (rt && discovery) {
      await AuthSession.revokeAsync({ clientId: config.cognitoClientId, token: rt, tokenTypeHint: AuthSession.TokenTypeHint.RefreshToken }, discovery).catch(() => undefined);
    }
  }, [tokens, save]);

  const getToken = useCallback(async () => {
    if (!tokens) return null;
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.idToken;
    if (!tokens.refreshToken || !discovery) return (await save(null), null);
    try {
      const t = await AuthSession.refreshAsync({ clientId: config.cognitoClientId, refreshToken: tokens.refreshToken }, discovery);
      const next = { idToken: t.idToken!, refreshToken: t.refreshToken ?? tokens.refreshToken, expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000 };
      await save(next);
      return next.idToken;
    } catch {
      await save(null);
      return null;
    }
  }, [tokens, save]);

  const value = useMemo(() => ({ ready, signedIn: !!tokens, signIn, signOut, getToken, completeWebSignIn }), [ready, tokens, signIn, signOut, getToken, completeWebSignIn]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
