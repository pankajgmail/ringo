import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { STAGES, type OutCall, type Stage } from "@ringo/shared";
import { useLive } from "./live.tsx";
import { Avatar, Badge, Chip, Icon, IconBtn, Meta, MetaText, Pill, s } from "./ui.tsx";
import { CATEGORY, OUTCOME, PRIORITY, STAGE } from "./labels.ts";
import { fmtDur, fmtResDay, fmtSched, fmtShort, fmtTime24, fmtWhen } from "./format.ts";
import { c } from "./theme.ts";

const LIVE = ["dialing", "in_progress", "awaiting_user"];
export const isLive = (call: OutCall) => LIVE.includes(call.status);

export const PriPill = ({ p }: { p: OutCall["priority"] }) => (
  <Pill text={`${PRIORITY[p].label} priority`} icon={PRIORITY[p].icon} color={PRIORITY[p].color} bg={PRIORITY[p].bg} iconOnly />
);

/** Two expanding rings behind the provider avatar while a call is live. */
function PulseAvatar({ providerId }: { providerId: string }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: 1800, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 40, borderWidth: 2, borderColor: c.primary,
        opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }]} />
      <Avatar providerId={providerId} size={60} round />
    </View>
  );
}

function useElapsed(since: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : 0;
}

/** Live tracker: pulsing avatar, timer, Queue → Dial → Menu → Hold → Talk → Done stepper, latest line, End. */
export function LiveCard({ call, onEnd }: { call: OutCall; onEnd?: () => void }) {
  const { stageLine, transcript } = useLive();
  const live = stageLine[call.id];
  const stage = live?.stage ?? call.stage;
  const stages: readonly Stage[] = call.category === "reservation" ? STAGES.filter((x) => x !== "menu" && x !== "hold") : STAGES;
  const idx = stages.indexOf(stage);
  const last = transcript[call.id]?.at(-1);
  const elapsed = useElapsed(call.startedAt);
  const cat = CATEGORY[call.category];
  const needsYou = call.status === "awaiting_user";
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, marginBottom: 8, marginHorizontal: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: needsYou ? c.amber : "#ef4444" }} />
        <Text style={st.h2}>{needsYou ? "Needs you" : "Live now"}</Text>
      </View>
      <Pressable onPress={() => router.push(`/call/${call.id}`)} accessibilityRole="button" accessibilityLabel={`Live call to ${call.name}, ${STAGE[stage].label}. Open details`}
        style={[s.card, st.live]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <PulseAvatar providerId={call.providerId} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: c.text, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{call.name}</Text>
            <Meta style={{ marginTop: 3 }}><Icon name={cat.icon} size={14} color={c.muted} /><MetaText>{cat.label}</MetaText><PriPill p={call.priority} /></Meta>
          </View>
          <Text style={{ color: c.text, fontWeight: "800", fontSize: 18, fontVariant: ["tabular-nums"] }}>{fmtDur(elapsed)}</Text>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={{ position: "absolute", left: 24, right: 24, top: 17, height: 2, backgroundColor: c.border }} />
          {stages.map((stp, i) => {
            const done = i < idx || stage === "done", cur = i === idx && stage !== "done";
            return (
              <View key={stp} style={{ alignItems: "center", gap: 4, width: 48 }}>
                <View style={[st.sdot, done && { backgroundColor: c.ok, borderColor: c.ok }, cur && { borderColor: c.amber }]}>
                  <Icon name={done ? "check" : STAGE[stp].icon} size={16} color={done ? "#052e1f" : cur ? c.amber : c.muted} />
                </View>
                <Text style={{ fontSize: 10, color: cur ? c.text : c.muted, fontWeight: cur ? "700" : "400" }}>{STAGE[stp].label}</Text>
              </View>
            );
          })}
        </View>
        <View style={st.bubble}>
          <Icon name="sparkles" size={14} color={c.primaryText} />
          <Text style={{ color: c.text, fontSize: 13, lineHeight: 19, flex: 1 }} numberOfLines={3}>
            {last ? <><Text style={{ fontWeight: "700" }}>{last.role === "agent" ? "RingVo" : "Rep"}: </Text>{last.text}</> : live?.line || "Getting a line…"}
          </Text>
        </View>
        {onEnd ? (
          <View style={{ alignItems: "center", gap: 4, marginTop: 6 }}>
            <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel={`End call to ${call.name}`} style={st.round}><Icon name="phone-off" color="#fff" /></Pressable>
            <Text style={{ fontSize: 11, color: c.muted }}>End</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Scheduled / queued call: colored priority edge, avatar, when, priority pill, remove. */
export function SchedRow({ call, onCancel }: { call: OutCall; onCancel: () => void }) {
  const w = call.status === "queued" ? { text: "Next up", due: true } : fmtSched(call.scheduledAt);
  const cat = CATEGORY[call.category];
  const r = call.reservation;
  return (
    <View style={[st.sched, { borderLeftColor: PRIORITY[call.priority].color }]}>
      <Avatar providerId={call.providerId} size={38} />
      <Pressable style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/call/${call.id}`)} accessibilityRole="button" accessibilityLabel={`${call.name}, ${w.text}. Open details`}>
        <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{call.name}</Text>
        <Meta style={{ marginTop: 2 }}>
          <Icon name={r ? "users" : cat.icon} size={13} color={c.muted} />
          <MetaText>{r ? `${r.party} · ${fmtResDay(r.date)} ${fmtTime24(r.time)}` : cat.label}</MetaText>
          <Icon name="clock" size={13} color={w.due ? c.amber : c.muted} />
          <MetaText color={w.due ? c.amber : undefined}>{w.text}</MetaText>
        </Meta>
      </Pressable>
      <PriPill p={call.priority} />
      <IconBtn icon="trash" label={`Remove ${call.name} call`} variant="ghost" size={34} onPress={onCancel} />
    </View>
  );
}

/** Finished out call: outcome badge, summary, duration / hold saved / reference chips. */
export function HistoryRow({ call }: { call: OutCall }) {
  const o = call.outcome ? OUTCOME[call.outcome] : OUTCOME.failed;
  const cat = CATEGORY[call.category];
  return (
    <Pressable onPress={() => router.push(`/call/${call.id}`)} accessibilityRole="button" accessibilityLabel={`${call.name}, ${o.label}. Open transcript`}
      style={({ pressed }) => [s.item, pressed && { borderColor: c.border2 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Badge icon={o.icon} color={o.color} bg={o.bg} label={o.label} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{call.name}</Text>
          <Meta style={{ marginTop: 2 }}><Icon name={cat.icon} size={13} color={c.muted} /><MetaText>{cat.label} · {fmtWhen(call.endedAt ?? call.startedAt ?? call.scheduledAt)}</MetaText></Meta>
        </View>
        <PriPill p={call.priority} />
        <Icon name="right" size={16} color={c.muted} />
      </View>
      {call.summary ? <Text style={st.sum}>{call.summary}</Text> : null}
      <View style={st.chips}>
        {call.durationSec ? <Chip icon="clock" text={fmtShort(call.durationSec)} /> : null}
        {call.holdSec ? <Chip icon="hourglass" text={`${Math.max(1, Math.round(call.holdSec / 60))}m hold saved`} tone="ok" /> : null}
        {call.reference ? <Chip icon="hash" text={call.reference} /> : null}
        <Chip icon="msg" text="Transcript" tone="act" />
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  h2: { fontSize: 12, color: c.muted, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: "700" },
  live: { borderColor: c.primary, backgroundColor: "#1b1f3b", gap: 0 },
  sdot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: c.field, borderWidth: 2, borderColor: c.border },
  bubble: { flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: c.field, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12, minHeight: 40 },
  round: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" },
  sched: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.field, borderWidth: 1, borderColor: c.border, borderLeftWidth: 4, borderRadius: 14, paddingVertical: 10, paddingLeft: 10, paddingRight: 6, marginBottom: 8 },
  sum: { color: "#cfd3e0", fontSize: 13, marginTop: 8, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
});
