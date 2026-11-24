import { useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InCallType } from "@ringo/shared";
import { useApi } from "@/api.ts";
import { Acc, Badge, Button, Chip, Choice, Count, Empty, ErrorBox, Icon, Initials, Loading, Meta, MetaText, Pill, Stat, Stats, s, useAccordion, useToast } from "@/ui.tsx";
import { IN_TYPE } from "@/labels.ts";
import { fmtPhone, fmtShort, fmtWhen } from "@/format.ts";
import { c } from "@/theme.ts";

type Filter = "all" | InCallType;

export default function InCalls() {
  const api = useApi();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const calls = useQuery({ queryKey: ["in-calls"], queryFn: api.inCalls, refetchInterval: 30_000 });
  const section = useAccordion<"forwarding" | "history">();
  const [filter, setFilter] = useState<Filter>("all");
  const qc = useQueryClient();
  const toast = useToast();
  const callBack = useMutation({
    mutationFn: (inCallId: string) => api.callBack(inCallId),
    onSuccess: (call) => { toast("phone", `Ringo is calling ${call.name} back`); qc.invalidateQueries({ queryKey: ["calls"] }); router.push(`/call/${call.id}`); },
    onError: (e) => toast("alert", e instanceof Error ? e.message : "Couldn't start the call"),
  });
  const all = calls.data ?? [];
  const rows = all.filter((x) => filter === "all" || x.type === filter);
  const on = !!me.data?.forwardingActive;
  const n = (t: InCallType) => all.filter((x) => x.type === t).length;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={calls.isRefetching} onRefresh={() => void calls.refetch()} tintColor={c.primary} />}>
      <Stats>
        <Stat icon="headphones" value={calls.data ? all.length : "–"} label="Answered" color={c.primaryText} />
        <Stat icon="bell" value={calls.data ? n("important") : "–"} label="Important" color={c.bad} />
        <Stat icon="ban" value={calls.data ? n("spam") : "–"} label="Spam blocked" color={c.muted} />
      </Stats>

      <Acc icon="forward" title="Call forwarding" style={on ? { borderColor: "rgba(52,211,153,.4)" } : undefined}
        right={me.data ? <Pill text={on ? "On" : "Off"} icon={on ? "check" : "x"} color={on ? c.ok : c.muted} bg={on ? c.okSoft : "#232a3f"} /> : undefined}
        sub={on ? "Ringo answers calls you miss" : "Let Ringo answer calls you miss"} {...section("forwarding")}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginVertical: 12 }} accessible
          accessibilityLabel="Missed calls to your phone go to Ringo">
          <View style={{ alignItems: "center", gap: 4 }}><Initials name={me.data?.name ?? "You"} size={44} /><Text style={s.meta}>You</Text></View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <View style={{ width: 36, height: 2, backgroundColor: on ? c.ok : c.border }} /><Icon name="right" size={16} color={on ? c.ok : c.muted} />
          </View>
          <View style={{ alignItems: "center", gap: 4 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.primarySoft, alignItems: "center", justifyContent: "center" }}><Icon name="headphones" color={c.primaryText} /></View>
            <Text style={s.meta}>Ringo</Text>
          </View>
        </View>
        <Text style={[s.muted, { textAlign: "center", fontSize: 13 }]}>
          {me.data?.ringoNumber
            ? `Calls you don't pick up go to your Ringo line ${fmtPhone(me.data.ringoNumber)}. Ringo screens them, blocks spam and takes a message.`
            : "You'll get a Ringo line once your account is set up."}
        </Text>
        {me.data?.ringoNumber ? <Button title={on ? "Forwarding settings" : "Set up forwarding"} icon="forward" kind={on ? "secondary" : "primary"} onPress={() => router.push("/forwarding")} /> : null}
      </Acc>

      <Acc icon="history" title="Call history" right={calls.data ? <Count n={all.length} /> : undefined}
        sub={all[0] ? `Last: ${all[0].callerName ?? fmtPhone(all[0].fromNumber)} · ${IN_TYPE[all[0].type].label}` : "No calls yet"} {...section("history")}>
        <Choice<Filter> label="Show" value={filter} onChange={setFilter} options={[
          { value: "all", label: "All", icon: "history" }, { value: "important", label: "Important", icon: "bell" },
          { value: "message", label: "Messages", icon: "msg" }, { value: "spam", label: "Spam", icon: "ban" }]} />
        {calls.isLoading ? <Loading /> : calls.error ? <ErrorBox error={calls.error} onRetry={calls.refetch} /> : rows.length ? rows.map((r) => {
          const t = IN_TYPE[r.type];
          return (
            <View key={r.id} style={s.item}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Badge icon={t.icon} color={t.color} bg={t.bg} label={t.label} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{r.callerName ?? fmtPhone(r.fromNumber)}</Text>
                  <Meta style={{ marginTop: 2 }}><Icon name="clock" size={13} color={c.muted} /><MetaText>{fmtWhen(r.startedAt)}</MetaText></Meta>
                </View>
                <Pill text={t.label} color={t.color} bg={t.bg} />
              </View>
              {r.summary ? <Text style={{ color: "#cfd3e0", fontSize: 13, marginTop: 8, lineHeight: 18 }}>{r.summary}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {r.durationSec ? <Chip icon="clock" text={fmtShort(r.durationSec)} /> : null}
                <Chip icon="phone" text={fmtPhone(r.fromNumber)} />
                {r.callbackNumber && r.type !== "spam" ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${r.callbackNumber}`)} accessibilityRole="link" accessibilityLabel={`Call back ${fmtPhone(r.callbackNumber)}`}>
                    <Chip icon="phone" text="Call back" tone="act" />
                  </Pressable>
                ) : null}
                {r.type !== "spam" ? (
                  <Pressable onPress={() => callBack.mutate(r.id)} disabled={callBack.isPending} accessibilityRole="button"
                    accessibilityLabel={`Have Ringo call ${r.callerName ?? fmtPhone(r.callbackNumber ?? r.fromNumber)} back`}>
                    <Chip icon={callBack.isPending && callBack.variables === r.id ? "loader" : "headphones"} text="Ringo calls back" tone="act" />
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        }) : <Empty icon="in" text={filter === "all" ? "No calls yet. Turn on forwarding so Ringo can answer." : "Nothing here."} />}
      </Acc>
    </ScrollView>
  );
}
