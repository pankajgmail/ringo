import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useAuth } from "@/auth.tsx";
import { devAuth } from "@/config.ts";
import { Button, s } from "@/ui.tsx";
import { c, space } from "@/theme.ts";

export default function SignIn() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={[s.screen, { justifyContent: "center", padding: space(6), gap: space(6) }]}>
      <Image source={require("../assets/ringo-icon-1024.png")} style={{ width: 96, height: 96, alignSelf: "center", borderRadius: 22 }} accessibilityLabel="Ringo" />
      <View style={{ gap: space(2) }}>
        <Text style={{ color: c.text, fontSize: 28, fontWeight: "800", textAlign: "center" }}>Ringo</Text>
        <Text style={[s.muted, { textAlign: "center", fontSize: 16 }]}>Your AI assistant that waits on hold, so you don't have to.</Text>
      </View>
      <Button
        title={devAuth ? "Continue (dev mode)" : "Continue with Google"}
        busy={busy}
        onPress={async () => {
          setBusy(true);
          setError(null);
          try { await signIn(); } catch { setError("Google sign-in didn't complete. Please try again."); } finally { setBusy(false); }
        }}
      />
      {error && <Text style={{ color: c.bad, textAlign: "center" }} accessibilityRole="alert">{error}</Text>}
      <Text style={[s.muted, { textAlign: "center", fontSize: 12 }]}>Ringo tells everyone it calls that it's an AI assistant and that the call may be recorded.</Text>
    </View>
  );
}
