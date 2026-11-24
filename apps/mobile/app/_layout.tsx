import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth.tsx";
import { LiveProvider } from "@/live.tsx";
import { useApi } from "@/api.ts";
import { getPushToken } from "@/push.ts";
import { AskSheet } from "@/AskSheet.tsx";
import { Loading, ToastProvider } from "@/ui.tsx";
import { c } from "@/theme.ts";

SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 250 });

/** Where a notification tap should land: the outbound call, or the In Call tab for a message. */
function openFromNotification(data: Record<string, unknown> | undefined) {
  if (typeof data?.outCallId === "string") router.push(`/call/${data.outCallId}`);
  else if (typeof data?.inCallId === "string") router.push("/in");
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

function Gate() {
  const { ready, signedIn } = useAuth();
  const api = useApi();

  useEffect(() => {
    if (!signedIn) return;
    getPushToken().then((t) => t && api.registerPush(t, Platform.OS as "ios" | "android")).catch(() => undefined);
    // Tapping a notification opens the call it's about, including when the tap launched the app.
    if (Platform.OS !== "web") {
      const last = Notifications.getLastNotificationResponse();
      if (last) { openFromNotification(last.notification.request.content.data); Notifications.clearLastNotificationResponse(); }
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openFromNotification(r.notification.request.content.data));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => undefined); }, [ready]);
  if (!ready) return <Loading />;
  return (
    <>
      <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTintColor: c.text, contentStyle: { backgroundColor: c.bg } }}>
        <Stack.Protected guard={signedIn} redirectTo="/sign-in">
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="call/[id]" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="forwarding" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="admin" options={{ headerShown: false, animation: "slide_from_right" }} />
          <Stack.Screen name="feedback" options={{ headerShown: false, animation: "slide_from_bottom" }} />
        </Stack.Protected>
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Protected guard={!signedIn} redirectTo="/">
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {signedIn ? <AskSheet /> : null}
    </>
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <LiveProvider>
            <ToastProvider>
              <StatusBar style="light" />
              <Gate />
            </ToastProvider>
          </LiveProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
