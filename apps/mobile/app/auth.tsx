import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/auth.tsx";
import { Button, ErrorLine, Loading, s } from "@/ui.tsx";
import { space } from "@/theme.ts";

// Cognito redirects here after Google sign-in. On web this finishes the sign-in;
// on native, expo-auth-session catches the redirect first and this screen just moves on.
export default function AuthCallback() {
  const { code, state, error_description } = useLocalSearchParams<{ code?: string; state?: string; error_description?: string }>();
  const { completeWebSignIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // the code can only be exchanged once
    started.current = true;
    if (!code || !state) {
      if (error_description) setError(error_description);
      else router.replace("/");
      return;
    }
    completeWebSignIn(code, state)
      .then(() => router.replace("/"))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Google sign-in didn't complete."));
  }, [code, state, error_description, completeWebSignIn]);

  if (!error) return <Loading />;
  return (
    <View style={[s.screen, { justifyContent: "center", padding: space(6), gap: space(4) }]}>
      <ErrorLine text={error} />
      <Button title="Back to sign in" icon="back" onPress={() => router.replace("/sign-in")} />
    </View>
  );
}
