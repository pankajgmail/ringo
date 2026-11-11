import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { STAGES, type OutCall, type Stage } from "@ringo/shared";
import { useLive } from "./live.tsx";
import { Card, Pill, s } from "./ui.tsx";
import { CATEGORY, OUTCOME, PRIORITY, STAGE_LABEL } from "./labels.ts";
import { fmtShort, fmtWhen } from "./format.ts";
import { c, space } from "./theme.ts";

const LIVE = ["dialing", "in_progress", "awaiting_user"];
export const isLive = (call: OutCall) => LIVE.includes(call.status);

/** Live tracker: Queue → Dial → Menu → Hold → Talk → Done, plus the latest line. */
export function LiveCard({ call }: { call: OutCall }) {
  const { stageLine, transcript } = useLive();
  const live = stageLine[call.id];
  const stage = live?.stage ?? call.stage;
  const stages: readonly Stage[] = call.category === "reservation" ? STAGES.filter((x) => x !== "menu" && x !== "hold") : STAGES;
  const idx = stages.indexOf(stage);
  const last = transcript[call.id]?.at(-1);
  return (
    <Pressable onPress={() => router.push(`/call/${call.id}`)} accessibilityRole="button" accessibilityLabel={`Live call to ${call.name}, ${STAGE_LABEL[stage]}`}>
      <Card style={{ borderColor: c.primary }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={s.h}>{call.name}</Text>
          <Pill text={call.status === "awaiting_user" ? "Needs you" : "Live"} color={call.status === "awaiting_user" ? c.warn : c.ok} bg={call.status === "awaiting_user" ? c.warnSoft : c.okSoft} />
        </View>
        <View style={{ flexDirection: "row", gap: space(1) }} accessibilityElementsHidden>
          {stages.map((st, i) => (
            <View key={st} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <View style={{ height: 4, alignSelf: "stretch", borderRadius: 2, backgroundColor: i <= idx ? c.primary : c.border }} />
              <Text style={{ fontSize: 11, color: i === idx ? c.primaryText : c.muted }}>{STAGE_LABEL[st]}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: c.text }} numberOfLines={2}>{last ? `${last.role === "agent" ? "Ringo" : "Rep"}: ${last.text}` : live?.line || "Getting a line…"}</Text>
      </Card>
    </Pressable>
  );
}

export function UpcomingRow({ call, onCancel }: { call: OutCall; onCancel: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: PRIORITY[call.priority].color }} accessibilityLabel={`${PRIORITY[call.priority].label} priority`} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontWeight: "600" }}>{call.name} · {CATEGORY[call.category].label}</Text>
        <Text style={s.muted} numberOfLines={1}>{call.status === "queued" ? "Next up" : fmtWhen(call.scheduledAt)} · {call.goal}</Text>
      </View>
      <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel={`Cancel call to ${call.name}`} hitSlop={12}>
        <Text style={{ color: c.bad, fontWeight: "600" }}>Cancel</Text>
      </Pressable>
    </View>
  );
}

export function HistoryRow({ call }: { call: OutCall }) {
  const o = call.outcome ? OUTCOME[call.outcome] : OUTCOME.failed;
  return (
    <Pressable onPress={() => router.push(`/call/${call.id}`)} accessibilityRole="button" style={{ paddingVertical: space(3), gap: 4, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: c.text, fontWeight: "600" }}>{call.name}</Text>
        <Pill text={o.label} color={o.color} bg={o.bg} />
      </View>
      <Text style={{ color: c.text }}>{call.summary}</Text>
      <Text style={s.muted}>
        {fmtWhen(call.startedAt ?? call.scheduledAt)} · {fmtShort(call.durationSec)}{call.holdSec ? ` · ${fmtShort(call.holdSec)} on hold` : ""}{call.reference ? ` · Ref ${call.reference}` : ""}
      </Text>
    </Pressable>
  );
}
