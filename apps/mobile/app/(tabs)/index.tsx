import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES, PRIORITIES, PROVIDERS, type AskMe, type Category, type Priority } from "@ringo/shared";
import { useApi } from "@/api.ts";
import { Button, Card, Choice, Empty, ErrorBox, Field, H, Loading, Muted, s } from "@/ui.tsx";
import { HistoryRow, LiveCard, UpcomingRow, isLive } from "@/CallCards.tsx";
import { CATEGORY, PRIORITY } from "@/labels.ts";
import { toE164 } from "@/format.ts";
import { c, space } from "@/theme.ts";

const PROVIDER_OPTS = [...PROVIDERS.map((p) => ({ value: p.id, label: p.name, color: p.color })), { value: "custom", label: "Other" }];

export default function OutCall() {
  const api = useApi();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const upcoming = useQuery({ queryKey: ["calls", "upcoming"], queryFn: () => api.calls("upcoming"), refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ["calls", "history"], queryFn: () => api.calls("history") });

  const [providerId, setProviderId] = useState("att");
  const [customName, setCustomName] = useState("");
  const [customNumber, setCustomNumber] = useState("");
  const [category, setCategory] = useState<Category>("billing");
  const [priority, setPriority] = useState<Priority>("medium");
  const [goal, setGoal] = useState("");
  const [limits, setLimits] = useState("");
  const [askMe, setAskMe] = useState<AskMe>("ask");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [resDate, setResDate] = useState("");
  const [resTime, setResTime] = useState("19:00");
  const [party, setParty] = useState("2");

  const create = useMutation({
    mutationFn: () => api.createCall({
      providerId, category, priority, goal, limits, askMe,
      ...(providerId === "custom" ? { name: customName, number: toE164(customNumber) } : {}),
      ...(when === "later" && scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
      ...(category === "reservation" ? { reservation: { date: resDate, time: resTime, party: Number(party) } } : {}),
    }),
    onSuccess: () => {
      setGoal(""); setLimits("");
      qc.invalidateQueries({ queryKey: ["calls"] });
    },
  });
  const cancel = useMutation({ mutationFn: api.cancelCall, onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }) });

  const live = upcoming.data?.filter(isLive) ?? [];
  const waiting = upcoming.data?.filter((x) => !isLive(x)) ?? [];
  const needsPhone = me.data && !me.data.phoneVerified;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      {live.map((call) => <LiveCard key={call.id} call={call} />)}

      {needsPhone ? (
        <Card style={{ borderColor: c.warn }}>
          <Text style={{ color: c.text }}>Add and verify your mobile number so Ringo can call for you.</Text>
          <Button title="Finish your profile" kind="ghost" onPress={() => router.push("/settings")} />
        </Card>
      ) : null}

      <Card>
        <H>Who should Ringo call?</H>
        <Choice label="Provider" value={providerId} options={PROVIDER_OPTS} onChange={setProviderId} />
        {providerId === "custom" ? (
          <>
            <Field label="Business name" value={customName} onChangeText={setCustomName} placeholder="Nopa Bistro" />
            <Field label="Business phone" value={customNumber} onChangeText={setCustomNumber} placeholder="(415) 555-0130" keyboardType="phone-pad" />
          </>
        ) : null}
        <Choice label="Call type" value={category} options={CATEGORIES.map((v) => ({ value: v, label: CATEGORY[v].label }))} onChange={setCategory} />

        {category === "reservation" ? (
          <View style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 2 }}><Field label="Date (YYYY-MM-DD)" value={resDate} onChangeText={setResDate} placeholder="2026-11-14" /></View>
            <View style={{ flex: 1 }}><Field label="Time" value={resTime} onChangeText={setResTime} placeholder="19:30" /></View>
            <View style={{ flex: 1 }}><Field label="Party" value={party} onChangeText={setParty} keyboardType="number-pad" /></View>
          </View>
        ) : null}

        <Field label="Goal of the call" value={goal} onChangeText={setGoal} placeholder={CATEGORY[category].placeholder} multiline />
        <View style={s.row}>
          {CATEGORY[category].quick.map(([label, text]) => (
            <Pressable key={label} style={s.chip} onPress={() => setGoal(text)} accessibilityRole="button" accessibilityLabel={`Use: ${label}`}>
              <Text style={{ color: c.primaryText }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Limits and fallback" value={limits} onChangeText={setLimits} placeholder={category === "reservation" ? "Any time 7–8:30 PM is OK" : "Accept a credit of $20 or more"} multiline />
        <Choice<AskMe> label="If the rep offers something else" value={askMe} onChange={setAskMe}
          options={[{ value: "ask", label: "Ask me" }, { value: "decline", label: "Decline & push" }, { value: "end", label: "End the call" }]} />
        <Choice label="Priority" value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY[p].label, color: PRIORITY[p].color }))} />
        <Choice label="When" value={when} onChange={setWhen} options={[{ value: "now", label: "As soon as possible" }, { value: "later", label: "Schedule" }]} />
        {when === "later" ? <Field label="Call at (YYYY-MM-DD HH:MM)" value={scheduledAt} onChangeText={setScheduledAt} placeholder="2026-11-12 09:00" /> : null}

        {create.error ? <ErrorBox error={create.error} /> : null}
        <Button title={when === "now" ? "Queue call" : "Schedule call"} onPress={() => create.mutate()} busy={create.isPending} disabled={!!needsPhone || goal.trim().length < 3} />
        {create.isSuccess ? <Text style={{ color: c.ok }} accessibilityLiveRegion="polite">Queued. You'll get a notification when it's done.</Text> : null}
      </Card>

      <Card>
        <H>Up next</H>
        {upcoming.isLoading ? <Loading /> : upcoming.error ? <ErrorBox error={upcoming.error} onRetry={upcoming.refetch} /> :
          waiting.length ? waiting.map((call) => <UpcomingRow key={call.id} call={call} onCancel={() => cancel.mutate(call.id)} />) : <Empty text="Nothing queued" />}
      </Card>

      <Card>
        <H>History</H>
        {history.isLoading ? <Loading /> : history.error ? <ErrorBox error={history.error} onRetry={history.refetch} /> :
          history.data?.length ? history.data.map((call) => <HistoryRow key={call.id} call={call} />) : <Empty text="Your finished calls show up here" />}
        <Muted>Tap a call to see the full transcript.</Muted>
      </Card>
    </ScrollView>
  );
}
