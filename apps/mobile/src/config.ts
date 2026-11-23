import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
// EXPO_PUBLIC_* env vars (set in EAS / .env) override app.json for per-stage builds.
/** "same-origin" means the web app and API share a host (CloudFront serves both), so use the page's origin. */
function resolveApiUrl(v: string) {
  return v === "same-origin" && typeof window !== "undefined" ? window.location.origin : v;
}

export const config = {
  apiUrl: resolveApiUrl(process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://localhost:8080"),
  cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN ?? extra.cognitoDomain ?? "",
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? extra.cognitoClientId ?? "",
  /** Public site for the privacy policy and terms (the web app's host). */
  webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? extra.webUrl ?? (typeof window !== "undefined" && window.location ? window.location.origin : ""),
  /** Show "Continue with Apple" once Apple is set up in Cognito (required for the App Store). */
  appleSignIn: (process.env.EXPO_PUBLIC_APPLE_SIGN_IN ?? extra.appleSignIn ?? "false") === "true",
  /** Used only when Cognito isn't configured: the API must run with AUTH_DEV_BYPASS=true. */
  devUser: process.env.EXPO_PUBLIC_DEV_USER ?? extra.devUser ?? "",
};
/** Dev sign-in only in development builds; release builds always require Google. */
export const devAuth = __DEV__ && !config.cognitoDomain;
