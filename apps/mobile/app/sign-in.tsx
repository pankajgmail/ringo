import { useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useAuth, type Provider } from "@/auth.tsx";
import { config, devAuth } from "@/config.ts";
import { LOGO_RATIO, LOGO_XML } from "@/brand.ts";
import { Button, ErrorLine, Icon, s, type IconName } from "@/ui.tsx";
import { c, space } from "@/theme.ts";

const POINTS: [IconName, string][] = [
  ["hourglass", "RingVo waits on hold and talks to the rep for you"],
  ["flame", "Priorities and scheduling, so urgent calls go first"],
  ["headphones", "Answers calls you miss, screens spam and takes messages"],
];

export default function SignIn() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (p: Provider) => {
    setBusy(p);
    setError(null);
    try { await signIn(p); } catch { setError("Sign-in didn't complete. Please try again."); } finally { setBusy(null); }
  };
  return (
    <View style={s.screen}>
      <View style={{ flex: 1, justifyContent: "center", padding: space(6), gap: space(6), maxWidth: 480, width: "100%", alignSelf: "center" }}>
        <View style={{ alignItems: "center", gap: 8 }} accessibilityRole="header" accessibilityLabel="RingVo. Never wait on hold again.">
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
        <View style={{ gap: 10 }}>
          {!devAuth && config.appleSignIn && Platform.OS !== "android" ? (
            <Button title="Continue with Apple" icon="user" kind="secondary" busy={busy === "SignInWithApple"} disabled={!!busy} onPress={() => go("SignInWithApple")} />
          ) : null}
          <Button title={devAuth ? "Continue (dev mode)" : "Continue with Google"} icon="user" busy={busy === "Google"} disabled={!!busy} onPress={() => go("Google")} />
          {error ? <ErrorLine text={error} /> : null}
        </View>
        <Text style={[s.meta, { textAlign: "center" }]}>RingVo tells everyone it calls that it's an AI assistant and that the call may be recorded.</Text>
        <Text style={[s.meta, { textAlign: "center" }]}>
          By continuing you agree to the{" "}
          <Text accessibilityRole="link" style={{ color: c.primaryText }} onPress={() => Linking.openURL(`${config.webUrl}/terms.html`)}>Terms</Text> and{" "}
          <Text accessibilityRole="link" style={{ color: c.primaryText }} onPress={() => Linking.openURL(`${config.webUrl}/privacy.html`)}>Privacy Policy</Text>.
        </Text>
      </View>
    </View>
  );
}
