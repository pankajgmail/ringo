import { Linking, Platform, ScrollView, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { CARRIERS, forwardingCodes, type Carrier } from "@ringo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { Button, Card, ErrorBox, Icon, IconBtn, Loading, Meta, MetaText, PageHeader, Pill, s, useToast, type IconName } from "@/ui.tsx";
import { CARRIER_LABEL } from "@/labels.ts";
import { fmtPhone } from "@/format.ts";
import { c } from "@/theme.ts";

/** Carrier conditional forwarding (requirements §2.3). iOS can't dial * / # codes from apps, so we copy instead. */
function CodeRow({ icon, label, code }: { icon: IconName; label: string; code: string | null }) {
  const toast = useToast();
  if (!code) return null;
  const canDial = Platform.OS === "android";
  return (
    <View style={[s.item, { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 0 }]}>
      <Icon name={icon} size={18} color={c.primaryText} />
      <View style={{ flex: 1 }}>
        <Text style={s.meta}>{label}</Text>
        <Text selectable style={{ color: c.text, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 15, marginTop: 2 }}>{code}</Text>
      </View>
      <IconBtn icon={canDial ? "phone" : "copy"} label={`${canDial ? "Dial" : "Copy"} ${label}`} size={36}
        onPress={async () => { if (canDial) await Linking.openURL(`tel:${encodeURIComponent(code)}`); else { await Clipboard.setStringAsync(code); toast("copy", "Code copied"); } }} />
    </View>
  );
}

const Step = ({ n, title }: { n: number; title: string }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c.primaryText, fontWeight: "800", fontSize: 13 }}>{n}</Text>
    </View>
    <Text style={s.h}>{title}</Text>
  </View>
);

export default function Forwarding() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const toggle = useMutation({
    mutationFn: (active: boolean) => api.setForwarding(active),
    onSuccess: (_r, active) => { toast(active ? "check-circle" : "x", active ? "Forwarding on" : "Forwarding off"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  const d = me.data;
  const [carrier, setCarrier] = useState<Carrier>("att");
  useEffect(() => { if (d?.carrier) setCarrier(d.carrier); }, [d?.carrier]);
  const f = d?.ringoNumber ? forwardingCodes(carrier, d.ringoNumber) : null;

  return (
    <View style={s.screen}>
      <PageHeader title="Call forwarding" sub={d?.ringoNumber ? `Missed calls → ${fmtPhone(d.ringoNumber)}` : undefined}
        right={d ? <Pill text={d.forwardingActive ? "On" : "Off"} icon={d.forwardingActive ? "check" : "x"} color={d.forwardingActive ? c.ok : c.muted} bg={d.forwardingActive ? c.okSoft : "#232a3f"} /> : undefined} />
      {me.isLoading ? <Loading /> : me.error ? <View style={s.scroll}><ErrorBox error={me.error} onRetry={me.refetch} /></View> : !d || !f ? (
        <View style={s.scroll}><ErrorBox error={new Error("No Ringo number assigned yet")} /></View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <Card>
            <Step n={1} title="Dial these codes on your phone" />
            <Text style={s.meta}>Codes depend on your carrier:</Text>
            <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Your carrier">
              {CARRIERS.map((v) => {
                const on = v === carrier;
                return (
                  <Pressable key={v} onPress={() => setCarrier(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={CARRIER_LABEL[v]}
                    style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.field }}>
                    <Text style={{ color: on ? c.text : c.muted, fontWeight: "600", fontSize: 13 }}>{CARRIER_LABEL[v]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={s.muted}>{Platform.OS === "android" ? "Tap the phone button for each code." : "Phones don't let apps dial these codes. Copy each one, paste it in your Phone app and call."}</Text>
            <CodeRow icon="clock" label="No answer after ~5 rings" code={f.noAnswer} />
            <CodeRow icon="phone-off" label="When you're busy or decline" code={f.busy} />
            <CodeRow icon="signal" label="When your phone is off or has no signal" code={f.unreachable} />
            <Meta><Icon name="alert" size={12} color={c.muted} /><MetaText>This replaces your carrier voicemail. Ringo takes messages instead.</MetaText></Meta>
          </Card>
          <Card>
            <Step n={2} title="Confirm it works" />
            <Text style={s.muted}>Ask a friend to call you and don't answer. Ringo should pick up after about 5 rings, and the call shows up in In Call history.</Text>
            {toggle.error ? <ErrorBox error={toggle.error} /> : null}
            <Button title={d.forwardingActive ? "Mark forwarding as off" : "It works, mark as on"} icon={d.forwardingActive ? "x" : "check-circle"}
              kind={d.forwardingActive ? "ghost" : "primary"} busy={toggle.isPending} onPress={() => toggle.mutate(!d.forwardingActive)} />
          </Card>
          <Card>
            <Step n={3} title="Turn it off any time" />
            <CodeRow icon="x-circle" label="Disable all forwarding" code={f.disable} />
            <CodeRow icon="help" label="Check status" code={f.check} />
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
