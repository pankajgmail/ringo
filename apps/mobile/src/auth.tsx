import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { config, devAuth } from "./config.ts";

WebBrowser.maybeCompleteAuthSession();

type Tokens = { idToken: string; refreshToken?: string; expiresAt: number };
type Auth = { ready: boolean; signedIn: boolean; signIn: () => Promise<void>; signOut: () => Promise<void>; getToken: () => Promise<string | null> };

const KEY = "ringo.tokens";
// SecureStore is native-only. On web, tokens live in sessionStorage (cleared when the tab closes).
const store = {
  get: (): Promise<string | null> => (Platform.OS === "web" ? Promise.resolve(sessionStorage.getItem(KEY)) : SecureStore.getItemAsync(KEY)),
  set: (v: string) => (Platform.OS === "web" ? Promise.resolve(sessionStorage.setItem(KEY, v)) : SecureStore.setItemAsync(KEY, v)),
  del: () => (Platform.OS === "web" ? Promise.resolve(sessionStorage.removeItem(KEY)) : SecureStore.deleteItemAsync(KEY)),
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
      if (raw) setTokens(JSON.parse(raw) as Tokens);
      setReady(true);
    });
  }, []);

  const save = useCallback(async (t: Tokens | null) => {
    setTokens(t);
    if (t) await store.set(JSON.stringify(t));
    else await store.del();
  }, []);

  const signIn = useCallback(async () => {
    if (devAuth) return save({ idToken: "dev", expiresAt: Number.MAX_SAFE_INTEGER });
    // identity_provider=Google skips Cognito's hosted page and goes straight to Google sign-in.
    const req = new AuthSession.AuthRequest({
      clientId: config.cognitoClientId, redirectUri, scopes: ["openid", "email", "profile"], usePKCE: true,
      extraParams: { identity_provider: "Google", prompt: "select_account" },
    });
    const res = await req.promptAsync(discovery!);
    if (res.type === "error") throw res.error ?? new Error("sign-in failed");
    if (res.type !== "success") return; // user cancelled
    const t = await AuthSession.exchangeCodeAsync(
      { clientId: config.cognitoClientId, code: res.params.code!, redirectUri, extraParams: { code_verifier: req.codeVerifier! } },
      discovery!,
    );
    await save({ idToken: t.idToken!, refreshToken: t.refreshToken, expiresAt: Date.now() + (t.expiresIn ?? 3600) * 1000 });
  }, [save]);

  const signOut = useCallback(() => save(null), [save]);

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

  const value = useMemo(() => ({ ready, signedIn: !!tokens, signIn, signOut, getToken }), [ready, tokens, signIn, signOut, getToken]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
