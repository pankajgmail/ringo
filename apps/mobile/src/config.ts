import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
// EXPO_PUBLIC_* env vars (set in EAS / .env) override app.json for per-stage builds.
export const config = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? extra.apiUrl ?? "http://localhost:8080",
  cognitoDomain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN ?? extra.cognitoDomain ?? "",
  cognitoClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? extra.cognitoClientId ?? "",
  /** Used only when Cognito isn't configured: the API must run with AUTH_DEV_BYPASS=true. */
  devUser: process.env.EXPO_PUBLIC_DEV_USER ?? extra.devUser ?? "",
};
/** Dev sign-in only in development builds; release builds always require Google. */
export const devAuth = __DEV__ && !config.cognitoDomain;
