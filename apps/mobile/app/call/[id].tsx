import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { useLive } from "@/live.tsx";
import { LiveCard, PriPill, isLive } from "@/CallCards.tsx";
import { Avatar, Badge, Button, Card, Chip, Empty, ErrorBox, Icon, Loading, Meta, MetaText, PageHeader, s, useToast } from "@/ui.tsx";
import { CATEGORY, OUTCOME } from "@/labels.ts";
import { fmtPhone, fmtShort, fmtWhen } from "@/format.ts";
import { c } from "@/theme.ts";

const OPEN = ["scheduled", "queued", "dialing", "in_progress", "awaiting_user"];

export default function CallDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const { transcript: liveLines } = useLive();
  const q = useQuery({ queryKey: ["calls", id], queryFn: () => api.call(id), refetchInterval: (query) => (query.state.data && OPEN.includes(query.state.data.status) ? 10_000 : false) });
  const cancel = useMutation({ mutationFn: () => api.cancelCall(id), onSuccess: () => { toast("x", "Call cancelled"); qc.invalidateQueries({ queryKey: ["calls"] }); } });
  // "Call again" or "Follow up": a new call with the same goal, carrying over what RingVo learned on this one.
  const repeat = useMutation({
    mutationFn: (at?: string) => api.repeatCall(id, at),
    onSuccess: (next) => {
      toast("check", next.status === "scheduled" ? `Follow-up scheduled for ${fmtWhen(next.scheduledAt)}` : "RingVo is calling again");
      qc.invalidateQueries({ queryKey: ["calls"] });
      router.replace(`/call/${next.id}`);
    },
  });

  const call = q.data;
  const lines = call ? (isLive(call) && (liveLines[id]?.length ?? 0) > call.transcript.length ? liveLines[id]! : call.transcript) : [];
  const o = call?.outcome ? OUTCOME[call.outcome] : null;
  const followUp = call?.followUpAt && !OPEN.includes(call.status) ? new Date(call.followUpAt) : null;
  const followUpLater = followUp && followUp.getTime() > Date.now() + 60 * 60_000;
  const appt = call?.appointmentAt ? new Date(call.appointmentAt) : null;

  return (
    <View style={s.screen}>
      <PageHeader title={call?.name ?? "Call"} sub={call ? `${CATEGORY[call.category].label} · ${fmtPhone(call.number)}` : undefined} />
      {q.isLoading ? <Loading /> : q.error || !call ? <View style={s.scroll}><ErrorBox error={q.error} onRetry={q.refetch} /></View> : (
        <ScrollView contentContainerStyle={s.scroll}>
          {isLive(call) ? <LiveCard call={call} onEnd={() => cancel.mutate()} /> : null}
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {o ? <Badge icon={o.icon} color={o.color} bg={o.bg} label={o.label} /> : <Avatar providerId={call.providerId} size={38} />}
              <View style={{ flex: 1 }}>
                <Text style={{ color: o?.color ?? c.text, fontWeight: "800", fontSize: 16 }}>{o?.label ?? (call.status === "scheduled" ? "Scheduled" : call.status === "queued" ? "Queued" : "In progress")}</Text>
                <Meta style={{ marginTop: 2 }}><Icon name="clock" size={13} color={c.muted} /><MetaText>{fmtWhen(call.endedAt ?? call.startedAt ?? call.scheduledAt)}</MetaText></Meta>
              </View>
              <PriPill p={call.priority} />
            </View>
            {call.summary ? <Text style={{ color: c.text, fontSize: 15, lineHeight: 21 }}>{call.summary}</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {call.durationSec ? <Chip icon="clock" text={fmtShort(call.durationSec)} /> : null}
              {call.holdSec ? <Chip icon="hourglass" text={`${Math.max(1, Math.round(call.holdSec / 60))}m hold saved`} tone="ok" /> : null}
              {call.reference ? <Chip icon="hash" text={`Ref ${call.reference}`} tone="act" /> : null}
              {call.savedCents ? <Chip icon="trend" text={`Saved $${(call.savedCents / 100).toFixed(2)}`} tone="ok" /> : null}
              {appt ? <Chip icon="cal" text={appt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} tone="act" /> : null}
              {call.onCalendar ? <Chip icon="check-circle" text="On your calendar" tone="ok" /> : null}
              {call.holdForMe ? <Chip icon="headphones" text="Hold for me" /> : null}
              {call.costCents != null ? <Chip icon="receipt" text={`$${(call.costCents / 100).toFixed(2)}`} /> : null}
            </View>
            <View style={[s.item, { marginBottom: 0, gap: 6 }]}>
              <Meta><Icon name="target" size={14} color={c.primaryText} /><MetaText>Goal</MetaText></Meta>
              <Text style={{ color: c.text, fontSize: 14 }}>{call.goal}</Text>
              {call.limits ? <>
                <Meta style={{ marginTop: 4 }}><Icon name="shield" size={14} color={c.primaryText} /><MetaText>Limits</MetaText></Meta>
                <Text style={{ color: c.text, fontSize: 14 }}>{call.limits}</Text>
              </> : null}
            </View>
            {OPEN.includes(call.status) && !isLive(call) ? (
              <Button title="Cancel call" icon="x" kind="danger" onPress={() => cancel.mutate()} busy={cancel.isPending} />
            ) : null}
            {cancel.error ? <ErrorBox error={cancel.error} /> : null}
            {followUp ? (
              <View style={[s.item, { marginBottom: 0, gap: 8, borderColor: c.primary }]} accessibilityRole="summary">
                <Meta><Icon name="bell" size={14} color={c.primaryText} /><MetaText>Follow-up suggested{followUpLater ? ` for ` : ""}</MetaText></Meta>
                {call.followUpNote ? <Text style={{ color: c.text, fontSize: 14 }}>{call.followUpNote}</Text> : null}
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <Button slim title="Follow up now" icon="phone" onPress={() => repeat.mutate(undefined)} busy={repeat.isPending && !repeat.variables} />
                  {followUpLater ? <Button slim kind="secondary" title={`Schedule for ${followUp!.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`} icon="cal"
                    onPress={() => repeat.mutate(call.followUpAt!)} busy={repeat.isPending && !!repeat.variables} /> : null}
                </View>
              </View>
            ) : !OPEN.includes(call.status) ? (
              <Button title="Call again" icon="refresh" kind="secondary" onPress={() => repeat.mutate(undefined)} busy={repeat.isPending} />
            ) : null}
            {repeat.error ? <ErrorBox error={repeat.error} /> : null}
          </Card>
          <Card>
            <Meta><Icon name="msg" size={16} color={c.primaryText} /><Text style={s.h}>Transcript</Text></Meta>
            {lines.length ? lines.map((l, i) => {
              const ringo = l.role === "agent";
              return (
                <View key={i} style={{ alignSelf: ringo ? "flex-end" : "flex-start", maxWidth: "85%", backgroundColor: ringo ? c.primarySoft : c.card2, borderRadius: 14, borderBottomRightRadius: ringo ? 4 : 14, borderBottomLeftRadius: ringo ? 14 : 4, paddingVertical: 8, paddingHorizontal: 12 }}>
                  <Text style={{ color: ringo ? c.primaryText : c.muted, fontSize: 11, fontWeight: "700", marginBottom: 2 }}>{ringo ? "RingVo" : l.role === "user" ? "You" : "Them"}</Text>
                  <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{l.text}</Text>
                </View>
              );
            }) : <Empty icon="msg" text="No transcript yet." />}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
