import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { useLive } from "@/live.tsx";
import { LiveCard, isLive } from "@/CallCards.tsx";
import { Button, Card, ErrorBox, H, Loading, Muted, Pill, s } from "@/ui.tsx";
import { CATEGORY, OUTCOME } from "@/labels.ts";
import { fmtShort, fmtWhen } from "@/format.ts";
import { c, space } from "@/theme.ts";

export default function CallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const qc = useQueryClient();
  const { transcript: liveLines } = useLive();
  const q = useQuery({ queryKey: ["calls", id], queryFn: () => api.call(id), refetchInterval: (query) => (query.state.data && isLive(query.state.data) ? 10_000 : false) });
  const cancel = useMutation({ mutationFn: () => api.cancelCall(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }) });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <View style={s.scroll}><ErrorBox error={q.error} onRetry={q.refetch} /></View>;
  const call = q.data;
  const lines = isLive(call) && (liveLines[id]?.length ?? 0) > call.transcript.length ? liveLines[id]! : call.transcript;
  const o = call.outcome ? OUTCOME[call.outcome] : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      <Stack.Screen options={{ title: call.name }} />
      {isLive(call) ? <LiveCard call={call} /> : null}
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <H>{CATEGORY[call.category].label}</H>
          {o ? <Pill text={o.label} color={o.color} bg={o.bg} /> : null}
        </View>
        {call.summary ? <Text style={{ color: c.text, fontSize: 16 }}>{call.summary}</Text> : null}
        {call.reference ? <Text selectable style={{ color: c.primaryText }}>Reference: {call.reference}</Text> : null}
        <Muted>Goal: {call.goal}</Muted>
        {call.limits ? <Muted>Limits: {call.limits}</Muted> : null}
        <Muted>{fmtWhen(call.startedAt ?? call.scheduledAt)} · {fmtShort(call.durationSec)}{call.holdSec ? ` · ${fmtShort(call.holdSec)} on hold` : ""}{call.costCents != null ? ` · $${(call.costCents / 100).toFixed(2)}` : ""}</Muted>
        {["scheduled", "queued", "dialing", "in_progress", "awaiting_user"].includes(call.status) ? (
          <Button title={isLive(call) ? "End call now" : "Cancel call"} kind="danger" onPress={() => cancel.mutate()} busy={cancel.isPending} />
        ) : null}
      </Card>
      <Card>
        <H>Transcript</H>
        {lines.length ? lines.map((l, i) => (
          <View key={i} style={{ alignSelf: l.role === "agent" ? "flex-end" : "flex-start", maxWidth: "85%", backgroundColor: l.role === "agent" ? c.primarySoft : c.card2, borderRadius: 12, padding: space(3) }}>
            <Text style={{ color: c.muted, fontSize: 11, marginBottom: 2 }}>{l.role === "agent" ? "Ringo" : "Them"}</Text>
            <Text style={{ color: c.text }}>{l.text}</Text>
          </View>
        )) : <Muted>No transcript yet.</Muted>}
      </Card>
    </ScrollView>
  );
}
