import { useState } from "react";
import { Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useAuth } from "@/auth.tsx";
import { devAuth } from "@/config.ts";
import { LOGO_RATIO, LOGO_XML } from "@/brand.ts";
import { Button, ErrorLine, Icon, s, type IconName } from "@/ui.tsx";
import { c, space } from "@/theme.ts";

const POINTS: [IconName, string][] = [
  ["hourglass", "Ringo waits on hold and talks to the rep for you"],
  ["flame", "Priorities and scheduling, so urgent calls go first"],
  ["headphones", "Answers calls you miss, screens spam and takes messages"],
];

export default function SignIn() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={s.screen}>
      <View style={{ flex: 1, justifyContent: "center", padding: space(6), gap: space(6), maxWidth: 480, width: "100%", alignSelf: "center" }}>
        <View style={{ alignItems: "center", gap: 8 }} accessibilityRole="header" accessibilityLabel="Ringo. Never wait on hold again.">
          <SvgXml xml={LOGO_XML} height={64} width={64 * LOGO_RATIO} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: c.primaryText }}>
            Never wait <Text style={{ color: c.amber, fontWeight: "800" }}>on hold again.</Text>
          </Text>
        </View>
        <View style={[s.card, { gap: 12 }]}>
          {POINTS.map(([icon, text]) => (
            <View key={text} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" }}><Icon name={icon} size={18} color={c.primaryText} /></View>
              <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>{text}</Text>
            </View>
          ))}
        </View>
        <View>
          <Button title={devAuth ? "Continue (dev mode)" : "Continue with Google"} icon="user" busy={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try { await signIn(); } catch { setError("Google sign-in didn't complete. Please try again."); } finally { setBusy(false); }
            }} />
          {error ? <ErrorLine text={error} /> : null}
        </View>
        <Text style={[s.meta, { textAlign: "center" }]}>Ringo tells everyone it calls that it's an AI assistant and that the call may be recorded.</Text>
      </View>
    </View>
  );
}
