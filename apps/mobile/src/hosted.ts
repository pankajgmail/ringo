import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

/** Where a hosted page (Google consent, Stripe Checkout) sends the user back to: this screen, on web or in the app. */
export const returnUrl = (path: string) => (Platform.OS === "web" ? `${window.location.origin}${path}` : `ringo:/${path}`);

/**
 * Opens a hosted page. On web the tab navigates away and comes back with query params, so this returns null.
 * In the app it opens an auth session and returns the query params of the URL it came back to (or null if closed).
 */
export async function openHosted(url: string, returnTo: string): Promise<URLSearchParams | null> {
  if (Platform.OS === "web") { window.location.assign(url); return null; }
  const r = await WebBrowser.openAuthSessionAsync(url, returnTo);
  return r.type === "success" ? new URL(r.url).searchParams : null;
}
