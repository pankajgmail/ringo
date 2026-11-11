import { Linking, Platform, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { Button, Card, ErrorBox, H, Loading, Muted, s } from "@/ui.tsx";
import { c, space } from "@/theme.ts";

/** Carrier conditional forwarding (requirements §2.3). iOS can't dial * / # codes from apps, so we copy instead. */
function CodeRow({ label, code }: { label: string; code: string | null }) {
  if (!code) return null;
  const canDial = Platform.OS === "android";
  return (
    <View style={{ gap: space(1) }}>
      <Text style={s.label}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space(2) }}>
        <Text selectable style={{ color: c.text, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 16, flex: 1 }}>{code}</Text>
        <Button title={canDial ? "Dial" : "Copy"} kind="ghost" onPress={() => (canDial ? Linking.openURL(`tel:${encodeURIComponent(code)}`) : Clipboard.setStringAsync(code))} />
      </View>
    </View>
  );
}

export default function Forwarding() {
  const api = useApi();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const toggle = useMutation({ mutationFn: (active: boolean) => api.setForwarding(active), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  if (me.isLoading) return <Loading />;
  const f = me.data?.forwarding;
  if (!f) return <View style={s.scroll}><ErrorBox error={new Error("No Ringo number assigned yet")} /></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      <Card>
        <H>1. Dial these codes on your phone</H>
        <Muted>{Platform.OS === "ios" ? "iPhone doesn't let apps dial these codes. Tap Copy, open the Phone app, paste and call." : "Tap Dial for each code."}</Muted>
        <CodeRow label="No answer after ~5 rings" code={f.noAnswer} />
        <CodeRow label="When you're busy or decline" code={f.busy} />
        <CodeRow label="When your phone is off or has no signal" code={f.unreachable} />
        <Muted>This replaces your carrier voicemail. Ringo takes messages instead.</Muted>
      </Card>
      <Card>
        <H>2. Confirm it works</H>
        <Muted>Ask a friend to call you and don't answer. Ringo should pick up after about 5 rings, and the call shows up in In Call history.</Muted>
        {toggle.error ? <ErrorBox error={toggle.error} /> : null}
        <Button title={me.data?.forwardingActive ? "Mark forwarding as off" : "It works, mark as on"} kind={me.data?.forwardingActive ? "ghost" : "primary"} busy={toggle.isPending} onPress={() => toggle.mutate(!me.data?.forwardingActive)} />
      </Card>
      <Card>
        <H>Turn forwarding off</H>
        <CodeRow label="Disable all forwarding" code={f.disable} />
        <CodeRow label="Check status" code={f.check} />
      </Card>
    </ScrollView>
  );
}
