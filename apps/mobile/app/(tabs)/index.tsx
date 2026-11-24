import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES, PRIORITIES, PRIORITY_RANK, type AskMe, type Category, type Priority } from "@ringo/shared";
import { useApi } from "@/api.ts";
import { Acc, Button, Count, Empty, ErrorBox, ErrorLine, Field, Icon, Loading, Meta, MetaText, Pill, Seg, Stat, Stats, StepLabel, s, useAccordion, useToast } from "@/ui.tsx";
import { WhoPicker, nearFrom, type Who, type WhoMode } from "@/WhoPicker.tsx";
import { HistoryRow, LiveCard, SchedRow, isLive } from "@/CallCards.tsx";
import { CATEGORY, OUTCOME, PRIORITY, TEMPLATES, type Template } from "@/labels.ts";
import { daysUntil, fmtPhone, fmtSched, localDate, toE164 } from "@/format.ts";
import { c } from "@/theme.ts";


/** Same rule as the prototype: bookings get urgent as the date nears; service changes beat billing questions. */
function suggestPriority(category: Category, resDate: string): Priority {
  if (category === "reservation") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resDate)) return "medium";
    const d = daysUntil(resDate);
    return d <= 0 ? "high" : d === 1 ? "medium" : "low";
  }
  return category === "service" ? "medium" : "low";
}

const fmtHold = (sec: number) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)}h` : `${Math.round(sec / 60)}m`);
const fmtMoney = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: cents >= 100_00 ? 0 : 2 })}`;
/** "3h 20m" or "45m": time Ringo spent so the user didn't have to. */
const fmtTimeSaved = (sec: number) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };

/** Headline number first: money saved, then the hours Ringo sat on hold or talked for you. */
function SavingsCard({ s: v }: { s: { savedCents: number; monthSavedCents: number; holdSec: number; talkSec: number; done: number } }) {
  if (!v.done && !v.savedCents && !v.talkSec) return null;
  return (
    <View style={[s.card, { flexDirection: "row", alignItems: "center", gap: 14 }]} accessible
      accessibilityLabel={`Ringo has saved you ${fmtMoney(v.savedCents)} and ${fmtTimeSaved(v.talkSec)} on the phone, including ${fmtTimeSaved(v.holdSec)} on hold`}>
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: c.okSoft, alignItems: "center", justifyContent: "center" }}><Icon name="sparkles" color={c.ok} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.meta}>Ringo has saved you</Text>
        <Text style={{ color: c.text, fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
          {fmtMoney(v.savedCents)} <Text style={{ color: c.muted, fontSize: 15, fontWeight: "600" }}>and {fmtTimeSaved(v.talkSec)}</Text>
        </Text>
        <Text style={s.meta}>{v.monthSavedCents ? `${fmtMoney(v.monthSavedCents)} this month · ` : ""}{fmtTimeSaved(v.holdSec)} of it on hold</Text>
      </View>
    </View>
  );
}

export default function OutCall() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const upcoming = useQuery({ queryKey: ["calls", "upcoming"], queryFn: () => api.calls("upcoming"), refetchInterval: 15_000 });
  const history = useQuery({ queryKey: ["calls", "history"], queryFn: () => api.calls("history") });
  const savings = useQuery({ queryKey: ["savings"], queryFn: api.savings });
  const billing = useQuery({ queryKey: ["billing"], queryFn: api.billing });
  const outOfCalls = !!billing.data?.available && !billing.data.subscribed && billing.data.freeLeft === 0;
  const price = billing.data ? `$${(billing.data.priceCents / 100).toFixed(2)}` : "";

  const section = useAccordion<"new" | "upcoming" | "history">();
  const [whoMode, setWhoMode] = useState<WhoMode>("provider");
  const [who, setWho] = useState<Who>(null);
  const [category, setCategory] = useState<Category>("billing");
  const [priorityPick, setPriorityPick] = useState<Priority | null>(null);
  const [goal, setGoal] = useState("");
  const [limits, setLimits] = useState("");
  const [askMe, setAskMe] = useState<AskMe>("ask");
  const [holdForMe, setHoldForMe] = useState(false);
  const [template, setTemplate] = useState<string | null>(null);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [resDate, setResDate] = useState(localDate());
  const [resTime, setResTime] = useState("19:00");
  const [party, setParty] = useState("2");
  const [more, setMore] = useState(false);
  const [formErr, setFormErr] = useState("");

  const suggested = suggestPriority(category, resDate);
  const priority = priorityPick ?? suggested;

  const create = useMutation({
    mutationFn: () => api.createCall({
      providerId: who!.providerId, category, priority, goal: goal.trim(), limits: limits.trim(), askMe, holdForMe,
      ...(who!.providerId === "custom" ? { name: who!.name.trim(), number: toE164(who!.number) } : {}),
      ...(when === "later" && scheduledAt ? { scheduledAt: new Date(scheduledAt.trim().replace(" ", "T")).toISOString() } : {}),
      ...(category === "reservation" ? { reservation: { date: resDate, time: resTime, party: Number(party) } } : {}),
    }),
    onSuccess: (call) => {
      setGoal(""); setLimits(""); setPriorityPick(null); setFormErr(""); setWho(null); setHoldForMe(false); setTemplate(null);
      toast(when === "now" ? "phone" : "cal", when === "now" ? `Calling ${call.name}…` : `Scheduled ${call.name}`);
      qc.invalidateQueries({ queryKey: ["calls"] });
      qc.invalidateQueries({ queryKey: ["savings"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
      section.openOnly("upcoming");
    },
  });
  const cancel = useMutation({
    mutationFn: api.cancelCall,
    onSuccess: () => { toast("trash", "Call removed"); qc.invalidateQueries({ queryKey: ["calls"] }); },
  });

  const live = upcoming.data?.filter(isLive) ?? [];
  const waiting = useMemo(() => (upcoming.data?.filter((x) => !isLive(x)) ?? [])
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || +new Date(a.scheduledAt) - +new Date(b.scheduledAt)), [upcoming.data]);
  const done = history.data ?? [];
  const holdSaved = done.reduce((n, x) => n + (x.holdSec ?? 0), 0);
  const profileIncomplete = !!me.data && !(me.data.name && me.data.phoneVerified && me.data.zip);
  const cat = CATEGORY[category];

  const useTemplate = (t: Template) => {
    setTemplate(t.id); setCategory(t.category); setGoal(t.goal); setLimits(t.limits); setHoldForMe(!!t.holdForMe);
    if (t.limits) setMore(true);
    if (t.who) setWhoMode(t.who);
    setFormErr("");
    section.openOnly("new");
  };

  const submit = () => {
    if (profileIncomplete) return setFormErr("Finish your profile and verify your phone first.");
    if (!who) return setFormErr(whoMode === "contact" ? "Pick a contact for Ringo to call." : whoMode === "other" ? "Add a name and phone number." : "Search and pick who Ringo should call.");
    if (who.providerId === "custom" && (!who.name.trim() || !/^\+1\d{10}$/.test(toE164(who.number)))) return setFormErr("Add a name and a US or Canada phone number.");
    if (goal.trim().length < 3) return setFormErr(category === "reservation" ? "Add any special requests, or just \"No special requests\"." : "Tell Ringo what to get done.");
    if (category === "reservation" && !/^\d{4}-\d{2}-\d{2}$/.test(resDate)) return setFormErr("Booking date must look like 2026-11-14.");
    if (when === "later" && Number.isNaN(new Date(scheduledAt.trim().replace(" ", "T")).getTime())) return setFormErr("Pick when Ringo should call, like 2026-11-24 09:00.");
    setFormErr("");
    create.mutate();
  };

  const top = waiting[0];
  const last = done[0];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={upcoming.isRefetching || history.isRefetching} onRefresh={() => { void upcoming.refetch(); void history.refetch(); }} tintColor={c.primary} />}>
      <Stats>
        <Stat icon="check-circle" value={history.data ? done.filter((x) => x.outcome === "success" || x.outcome === "partial").length : "–"} label="Calls done" color={c.ok} />
        <Stat icon="hourglass" value={history.data ? fmtHold(holdSaved) : "–"} label="Hold saved" color={c.amber} />
        <Stat icon="cal" value={upcoming.data ? waiting.length : "–"} label="Scheduled" />
      </Stats>

      {profileIncomplete ? (
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Finish your profile so Ringo can call for you"
          style={[s.card, { flexDirection: "row", alignItems: "center", gap: 10, borderColor: "rgba(251,191,36,.45)", backgroundColor: "rgba(245,158,11,.08)" }]}>
          <Icon name="user" color={c.warn} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: "700" }}>Finish your profile</Text>
            <Text style={s.meta}>Add your name and ZIP code, and verify your phone, so Ringo can call for you.</Text>
          </View>
          <Icon name="right" size={18} color={c.warn} />
        </Pressable>
      ) : null}

      {savings.data ? <SavingsCard s={savings.data} /> : null}

      {billing.data?.available && !billing.data.subscribed ? (
        <Pressable onPress={() => router.push("/settings")} accessibilityRole="button"
          accessibilityLabel={outOfCalls ? "Free calls used up. Subscribe in Settings" : `${billing.data.freeLeft} free calls left. See plan`}
          style={[s.card, { flexDirection: "row", alignItems: "center", gap: 12, borderColor: outOfCalls ? c.warn : c.border }]}>
          <Icon name={outOfCalls ? "alert" : "sparkles"} color={outOfCalls ? c.warn : c.primaryText} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.text, fontWeight: "700" }}>
              {outOfCalls ? "You've used your free calls" : `${billing.data.freeLeft} of ${billing.data.freeCalls} free calls left`}
            </Text>
            <Text style={s.meta}>{outOfCalls ? `Subscribe for ${price}/month to keep calling` : `Then ${price}/month for unlimited calls`}</Text>
          </View>
          <Icon name="chev" size={16} color={c.muted} />
        </Pressable>
      ) : null}

      <View style={{ marginBottom: 12 }}>
        <Text style={[s.meta, { marginBottom: 6 }]}>Quick start</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Quick start tasks">
          {TEMPLATES.map((t) => {
            const on = template === t.id;
            return (
              <Pressable key={t.id} onPress={() => useTemplate(t)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Start: ${t.label}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1,
                  borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.card }}>
                <Icon name={t.icon} size={16} color={on ? c.primaryText : c.muted} />
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "600" }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {live.map((call) => <LiveCard key={call.id} call={call} onEnd={() => cancel.mutate(call.id)} />)}

      <Acc icon="plus" title="New call" sub="Ringo calls for you" {...section("new")}>
        <StepLabel>Who</StepLabel>
        <WhoPicker mode={whoMode} onMode={setWhoMode} who={who} onWho={setWho} defaultNear={me.data?.zip || nearFrom(me.data?.address)} />

        <StepLabel>What</StepLabel>
        <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Call type">
          {CATEGORIES.map((v) => {
            const on = v === category;
            return (
              <Pressable key={v} onPress={() => setCategory(v)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={CATEGORY[v].label}
                style={{ flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primarySoft : c.field }}>
                <Icon name={CATEGORY[v].icon} color={on ? c.primaryText : c.muted} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: on ? c.text : c.muted }}>{CATEGORY[v].label}</Text>
              </Pressable>
            );
          })}
        </View>

        {category === "reservation" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Field style={{ flex: 2 }} label="Date YYYY-MM-DD" icon="cal" value={resDate} onChangeText={setResDate} />
            <Field style={{ flex: 1.4 }} label="Time" icon="clock" value={resTime} onChangeText={setResTime} />
            <Field style={{ flex: 1 }} label="Party" icon="users" value={party} onChangeText={setParty} keyboardType="number-pad" />
          </View>
        ) : null}

        <Field label={cat.placeholder} icon="target" value={goal} onChangeText={setGoal} multiline />
        <View style={[s.row, { marginTop: 8 }]}>
          {cat.quick.map(([label, text]) => (
            <Pressable key={label} onPress={() => setGoal(text)} accessibilityRole="button" accessibilityLabel={`Use: ${label}`}
              style={[s.fchip, goal === text && { borderColor: c.primary, backgroundColor: c.primarySoft }]}>
              <Icon name="sparkles" size={12} color={c.primaryText} />
              <Text style={{ color: c.primaryText, fontSize: 12, fontWeight: "600" }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <StepLabel right={priorityPick === null || priorityPick === suggested
          ? <Pill text="Suggested" icon="sparkles" color={c.primaryText} bg={c.primarySoft} />
          : <Pressable onPress={() => setPriorityPick(null)} accessibilityRole="button" hitSlop={8}><Text style={{ color: c.primaryText, fontSize: 12 }}>Use suggested ({PRIORITY[suggested].label})</Text></Pressable>}>
          Priority
        </StepLabel>
        <Seg<Priority> label="Priority" value={priority} onChange={setPriorityPick}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY[p].label, icon: PRIORITY[p].icon, tone: PRIORITY[p] }))} />

        <StepLabel>When a person answers</StepLabel>
        <Seg<"no" | "yes"> label="When a person answers" value={holdForMe ? "yes" : "no"} onChange={(v) => setHoldForMe(v === "yes")}
          options={[{ value: "no", label: "Ringo handles it", icon: "headphones" }, { value: "yes", label: "Hold for me", icon: "phone" }]} />
        {holdForMe ? (
          <Meta style={{ marginTop: 6 }}>
            <Icon name="hourglass" size={12} color={c.muted} />
            <MetaText>Ringo waits through the menu and hold music, then calls {me.data?.phone ? fmtPhone(me.data.phone) : "you"} and connects you the moment a person picks up.</MetaText>
          </Meta>
        ) : null}

        <StepLabel>When</StepLabel>
        <Seg label="When" value={when} onChange={setWhen} options={[{ value: "now", label: "Now", icon: "zap" }, { value: "later", label: "Schedule", icon: "cal" }]} />
        {when === "later" ? <Field label="Call at YYYY-MM-DD HH:MM" icon="clock" value={scheduledAt} onChangeText={setScheduledAt} /> : null}

        <Pressable onPress={() => setMore((m) => !m)} accessibilityRole="button" accessibilityState={{ expanded: more }}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 }}>
          <Icon name="sliders" size={16} color={c.primaryText} />
          <Text style={{ color: c.primaryText, fontWeight: "600", fontSize: 13 }}>More options</Text>
          <View style={{ transform: [{ rotate: more ? "180deg" : "0deg" }] }}><Icon name="chev" size={14} color={c.primaryText} /></View>
        </Pressable>
        {more ? (
          <>
            <Field label={category === "reservation" ? "Limits, e.g. any time 7–8:30 PM is OK" : "Limits, e.g. accept a credit of $20 or more"} icon="shield" value={limits} onChangeText={setLimits} multiline />
            <StepLabel>If they offer something else</StepLabel>
            <Seg<AskMe> label="If they offer something else" value={askMe} onChange={setAskMe}
              options={[{ value: "ask", label: "Ask me", icon: "msg" }, { value: "decline", label: "Skip", icon: "skip" }, { value: "end", label: "Hang up", icon: "phone-off" }]} />
          </>
        ) : null}

        {formErr ? <ErrorLine text={formErr} /> : create.error ? <ErrorBox error={create.error} /> : null}
        {outOfCalls ? <Button title={`Subscribe to keep calling, ${price}/mo`} icon="card" onPress={() => router.push("/settings")} /> : null}
        <Button title={holdForMe ? (when === "now" ? "Hold for me now" : "Schedule hold for me") : when === "now" ? "Call now" : "Schedule call"} icon={when === "now" ? "phone" : "cal"} onPress={submit} busy={create.isPending} />
        <Meta style={{ justifyContent: "center", marginTop: 10 }}>
          <Icon name="shield" size={12} color={c.muted} />
          <MetaText>Ringo tells them it's an AI assistant calling for you.</MetaText>
        </Meta>
      </Acc>

      <Acc icon="cal" title="Scheduled" right={upcoming.data ? <Count n={waiting.length} /> : undefined}
        sub={top ? `Top: ${top.name} · ${top.status === "queued" ? "Next up" : fmtSched(top.scheduledAt).text}` : "Nothing queued"} {...section("upcoming")}>
        {upcoming.isLoading ? <Loading /> : upcoming.error ? <ErrorBox error={upcoming.error} onRetry={upcoming.refetch} /> : waiting.length ? (
          <>
            <Meta style={{ marginBottom: 8, gap: 10 }}>
              {PRIORITIES.map((p) => (
                <View key={p} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name={PRIORITY[p].icon} size={12} color={PRIORITY[p].color} /><MetaText>{PRIORITY[p].label}</MetaText>
                </View>
              ))}
              <MetaText>· sorted by priority</MetaText>
            </Meta>
            {waiting.map((call) => <SchedRow key={call.id} call={call} onCancel={() => cancel.mutate(call.id)} />)}
          </>
        ) : <Empty icon="cal" text="Nothing scheduled. Start a new call above." />}
      </Acc>

      <Acc icon="history" title="History" right={history.data ? <Count n={done.length} /> : undefined}
        sub={last ? `Last: ${last.name} · ${(last.outcome ? OUTCOME[last.outcome] : OUTCOME.failed).label}` : "No calls yet"} {...section("history")}>
        {history.isLoading ? <Loading /> : history.error ? <ErrorBox error={history.error} onRetry={history.refetch} /> :
          done.length ? done.map((call) => <HistoryRow key={call.id} call={call} />) : <Empty text="Your finished calls show up here." />}
      </Acc>
    </ScrollView>
  );
}
