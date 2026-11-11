import { useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { InCallType } from "@ringo/shared";
import { useApi } from "@/api.ts";
import { Button, Card, Choice, Empty, ErrorBox, H, Loading, Muted, Pill, s } from "@/ui.tsx";
import { IN_TYPE } from "@/labels.ts";
import { fmtPhone, fmtShort, fmtWhen } from "@/format.ts";
import { c, space } from "@/theme.ts";

export default function InCalls() {
  const api = useApi();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const calls = useQuery({ queryKey: ["in-calls"], queryFn: api.inCalls });
  const [filter, setFilter] = useState<"all" | InCallType>("all");
  const rows = (calls.data ?? []).filter((x) => filter === "all" || x.type === filter);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={calls.isRefetching} onRefresh={() => void calls.refetch()} tintColor={c.primary} />}>
      <Card style={{ borderColor: me.data?.forwardingActive ? c.ok : c.border }}>
        <H>{me.data?.forwardingActive ? "Ringo answers your missed calls" : "Let Ringo answer missed calls"}</H>
        <Muted>
          {me.data?.ringoNumber
            ? `Calls you don't pick up after about 5 rings go to your Ringo number ${fmtPhone(me.data.ringoNumber)}. Ringo screens them and takes a message.`
            : "You'll get a Ringo number once your account is set up."}
        </Muted>
        {me.data?.ringoNumber ? <Button title={me.data.forwardingActive ? "Forwarding settings" : "Set up forwarding"} kind={me.data.forwardingActive ? "ghost" : "primary"} onPress={() => router.push("/forwarding")} /> : null}
      </Card>

      <Choice label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "important", label: "Important" }, { value: "message", label: "Messages" }, { value: "spam", label: "Spam" }]} />

      <Card>
        <H>In Call history</H>
        {calls.isLoading ? <Loading /> : calls.error ? <ErrorBox error={calls.error} onRetry={calls.refetch} /> : rows.length ? rows.map((r) => (
          <View key={r.id} style={{ paddingVertical: space(3), gap: 4, borderBottomWidth: 1, borderColor: c.border }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: c.text, fontWeight: "600" }}>{r.callerName ?? fmtPhone(r.fromNumber)}</Text>
              <Pill text={IN_TYPE[r.type].label} color={IN_TYPE[r.type].color} bg={IN_TYPE[r.type].bg} />
            </View>
            {r.summary ? <Text style={{ color: c.text }}>{r.summary}</Text> : null}
            <Text style={s.muted}>{fmtWhen(r.startedAt)} · {fmtShort(r.durationSec)} · {fmtPhone(r.fromNumber)}</Text>
            {r.callbackNumber && r.type !== "spam" ? (
              <Pressable onPress={() => Linking.openURL(`tel:${r.callbackNumber}`)} accessibilityRole="link">
                <Text style={{ color: c.primaryText, fontWeight: "600" }}>Call back {fmtPhone(r.callbackNumber)}</Text>
              </Pressable>
            ) : null}
          </View>
        )) : <Empty text="No calls yet" />}
      </Card>
    </ScrollView>
  );
}
