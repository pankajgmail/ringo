import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { openHosted, returnUrl } from "@/hosted.ts";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, type Billing } from "@/api.ts";
import { useAuth } from "@/auth.tsx";
import { Acc, Button, Choice, ErrorBox, Field, Icon, IconBtn, Initials, Loading, Meta, MetaText, PageHeader, Pill, Seg, s, useAccordion, useToast } from "@/ui.tsx";
import type { InfoMode } from "@ringo/shared";
import { fmtPhone, toE164 } from "@/format.ts";
import { config } from "@/config.ts";
import Constants from "expo-constants";
import { c } from "@/theme.ts";

const INFO_SUB: Record<InfoMode, string> = {
  prompt: "Ask me in the app", sms: "Text me (SMS)", whatsapp: "Message me on WhatsApp", conference: "Call me and connect me to the rep",
};
const fmtPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const planSub = (b: Billing) =>
  b.subscribed ? (b.cancelAtPeriodEnd && b.renewsAt ? `Ends ${fmtDate(b.renewsAt)}` : "Unlimited calls") : `${b.freeLeft} of ${b.freeCalls} free calls left`;

function confirm(msg: string, ok = "Delete") {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(msg));
  return new Promise<boolean>((res) => Alert.alert("Are you sure?", msg, [{ text: "Cancel", onPress: () => res(false) }, { text: ok, style: "destructive", onPress: () => res(true) }]));
}

export default function Settings() {
  const api = useApi();
  const toast = useToast();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const section = useAccordion<"profile" | "plan" | "calls" | "calendar" | "line" | "account">();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [zipErr, setZipErr] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name); setEmail(me.data.email); setPhone(me.data.phone ?? ""); setAddress(me.data.address); setZip(me.data.zip ?? "");
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.saveProfile({ name: name.trim(), email: email.trim(), phone: toE164(phone), address: address.trim(), zip: zip.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: () => { toast("check", "Profile saved"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  const sendCode = useMutation({ mutationFn: () => api.startPhoneVerify(toE164(phone)), onSuccess: () => { setCodeSent(true); toast("msg", "Code sent"); } });
  const checkCode = useMutation({
    mutationFn: () => api.checkPhoneVerify(toE164(phone), code),
    onSuccess: () => { setCodeSent(false); setCode(""); toast("check-circle", "Phone verified"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });

  const infoMode = useMutation({
    mutationFn: (m: InfoMode) => api.setInfoMode(m),
    onMutate: (m) => qc.setQueryData(["me"], (old: typeof me.data) => (old ? { ...old, infoMode: m } : old)),
    onSuccess: (r) => toast("check", { conference: "Ringo will call you in", sms: "Ringo will text you", whatsapp: "Ringo will WhatsApp you", prompt: "Ringo will ask in the app" }[r.infoMode]),
    onError: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  // Google Calendar: the OAuth callback comes back here with ?calendar=connected|error.
  const params = useLocalSearchParams<{ calendar?: string; message?: string; billing?: string }>();
  const billing = useQuery({ queryKey: ["billing"], queryFn: api.billing });
  // Stripe Checkout comes back with ?billing=success|cancelled. The webhook may land a moment later, so refetch twice.
  useEffect(() => {
    if (!params.billing) return;
    if (params.billing === "success") { toast("check-circle", "You're subscribed. Thanks!"); section.openOnly("plan"); }
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ["billing"] }), 3000);
    qc.invalidateQueries({ queryKey: ["billing"] });
    router.setParams({ billing: undefined });
    return () => clearTimeout(t);
  }, [params.billing]);
  const subscribe = useMutation({
    mutationFn: async () => {
      const returnTo = returnUrl("/settings");
      const q = await openHosted((await api.checkout(returnTo)).url, returnTo);
      if (q?.get("billing") === "success") toast("check-circle", "You're subscribed. Thanks!");
      await qc.invalidateQueries({ queryKey: ["billing"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["billing"] }), 3000);
    },
  });
  const manage = useMutation({
    mutationFn: async () => {
      const returnTo = returnUrl("/settings");
      await openHosted((await api.billingPortal(returnTo)).url, returnTo);
      await qc.invalidateQueries({ queryKey: ["billing"] });
    },
  });
  useEffect(() => {
    if (!params.calendar) return;
    if (params.calendar === "connected") { toast("check-circle", "Google Calendar connected"); section.openOnly("calendar"); }
    else toast("alert", params.message || "Couldn't connect Google Calendar");
    qc.invalidateQueries({ queryKey: ["me"] });
    router.setParams({ calendar: undefined, message: undefined });
  }, [params.calendar]);

  const connectCal = useMutation({
    mutationFn: async () => {
      const returnTo = returnUrl("/settings");
      const { url } = await api.connectCalendar(returnTo);
      const q = await openHosted(url, returnTo);
      if (!q) return;
      if (q.get("calendar") === "connected") toast("check-circle", "Google Calendar connected");
      else throw new Error(q.get("message") || "Couldn't connect Google Calendar");
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
  const disconnectCal = useMutation({
    mutationFn: api.disconnectCalendar,
    onSuccess: () => { toast("check", "Google Calendar disconnected"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  const calPref = useMutation({
    mutationFn: (p: { calendarCheck?: boolean; calendarSave?: boolean }) => api.setPrefs(p),
    onMutate: (p) => qc.setQueryData(["me"], (old: typeof me.data) => (old ? { ...old, calendar: { ...old.calendar, ...(p.calendarCheck != null && { check: p.calendarCheck }), ...(p.calendarSave != null && { save: p.calendarSave }) } } : old)),
    onError: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });

  const delMe = useMutation({ mutationFn: api.deleteMe, onSuccess: () => signOut() });

  const d = me.data;
  const phoneChanged = !!d && toE164(phone) !== (d.phone ?? "");

  return (
    <View style={s.screen}>
      <PageHeader title="Settings" sub="Profile and your Ringo line" />
      {me.isLoading ? <Loading /> : me.error ? <View style={s.scroll}><ErrorBox error={me.error} onRetry={me.refetch} /></View> : (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", gap: 6, marginVertical: 10 }}>
            <Initials name={name || d?.email || "?"} size={72} />
            <Text style={{ color: c.text, fontWeight: "800", fontSize: 18 }}>{name || "Your name"}</Text>
            {d?.phoneVerified
              ? <Pill text="Phone verified" icon="check-circle" color={c.ok} bg={c.okSoft} />
              : <Pill text="Verify your phone" icon="alert" color={c.warn} bg={c.warnSoft} />}
          </View>

          <Acc icon="user" title="Profile" sub={d?.phone ? fmtPhone(d.phone) : "Name, phone, email, address"}
            right={d && !(d.name && d.phoneVerified && d.zip) ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.amber }} /> : undefined} {...section("profile")}>
            <Field label="Full name" icon="user" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
            <Field label="Mobile number" icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
            <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Field label="ZIP code (required, to find businesses near you)" icon="pin" value={zip} error={zipErr}
              onChangeText={(v) => { setZip(v.replace(/\D/g, "").slice(0, 5)); setZipErr(""); }}
              keyboardType="number-pad" autoComplete="postal-code" textContentType="postalCode" maxLength={5} />
            <Field label="Street address (optional)" icon="pin" value={address} onChangeText={setAddress} autoComplete="street-address" textContentType="fullStreetAddress" />
            {save.error ? <ErrorBox error={save.error} /> : null}
            <Button title="Save profile" icon="check" busy={save.isPending}
              onPress={() => { if (!/^\d{5}$/.test(zip.trim())) return setZipErr("Enter your 5-digit ZIP code"); save.mutate(); }} />

            {d?.phone && (!d.phoneVerified || phoneChanged) ? (
              <View style={[s.item, { marginTop: 12, borderColor: "rgba(251,191,36,.45)" }]}>
                <Meta><Icon name="shield" size={14} color={c.warn} /><MetaText color={c.warn}>Verify {fmtPhone(d.phone)} to start making calls</MetaText></Meta>
                {codeSent ? (
                  <>
                    <Field label="6-digit code" icon="hash" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" />
                    <Button title="Verify" icon="check-circle" slim onPress={() => checkCode.mutate()} busy={checkCode.isPending} disabled={code.length < 4} />
                    {checkCode.error ? <ErrorBox error={checkCode.error} /> : null}
                  </>
                ) : <Button title="Text me a code" icon="msg" kind="secondary" slim onPress={() => sendCode.mutate()} busy={sendCode.isPending} />}
                {sendCode.error ? <ErrorBox error={sendCode.error} /> : null}
              </View>
            ) : null}
          </Acc>

          {billing.data?.available ? (
            <Acc icon="card" title="Plan" sub={planSub(billing.data)}
              right={billing.data.subscribed ? <Pill text="Ringo monthly" icon="check" color={c.ok} bg={c.okSoft} /> : <Pill text={`${billing.data.freeLeft} free left`} icon="sparkles" color={billing.data.freeLeft ? c.primaryText : c.warn} bg={billing.data.freeLeft ? c.primarySoft : c.warnSoft} />}
              {...section("plan")}>
              {billing.data.subscribed ? (
                <>
                  <Text style={s.muted}>
                    Unlimited calls for {fmtPrice(billing.data.priceCents)}/month.{" "}
                    {billing.data.renewsAt ? (billing.data.cancelAtPeriodEnd ? `Ends ${fmtDate(billing.data.renewsAt)}.` : `Renews ${fmtDate(billing.data.renewsAt)}.`) : ""}
                  </Text>
                  {billing.data.status === "past_due" ? <Meta style={{ marginTop: 6 }}><Icon name="alert" size={12} color={c.warn} /><MetaText color={c.warn}>Your last payment didn't go through. Update your card to keep calling.</MetaText></Meta> : null}
                  <Button title="Manage subscription" icon="card" kind="secondary" slim onPress={() => manage.mutate()} busy={manage.isPending} />
                  {manage.error ? <ErrorBox error={manage.error} /> : null}
                </>
              ) : (
                <>
                  <Text style={s.muted}>
                    {billing.data.freeLeft
                      ? `You have ${billing.data.freeLeft} of ${billing.data.freeCalls} free calls left. After that, Ringo is ${fmtPrice(billing.data.priceCents)}/month for unlimited calls.`
                      : `You've used your ${billing.data.freeCalls} free calls. Subscribe for ${fmtPrice(billing.data.priceCents)}/month to keep Ringo calling for you.`}
                    {" "}Cancel anytime. Answering missed calls stays free.
                  </Text>
                  <Button title={`Subscribe, ${fmtPrice(billing.data.priceCents)}/month`} icon="card" onPress={() => subscribe.mutate()} busy={subscribe.isPending} />
                  <Meta style={{ justifyContent: "center", marginTop: 6 }}><Icon name="shield" size={12} color={c.muted} /><MetaText>Secure payment by Stripe. Ringo never sees your card.</MetaText></Meta>
                  <Text style={[s.meta, { textAlign: "center", marginTop: 6, lineHeight: 17 }]}>
                    Ringo monthly renews automatically at {fmtPrice(billing.data.priceCents)} each month until you cancel. Cancel anytime in Manage subscription; you keep access until the end of the paid month.{" "}
                    <Text accessibilityRole="link" style={{ color: c.primaryText }} onPress={() => Linking.openURL(`${config.webUrl}/terms.html`)}>Terms</Text> ·{" "}
                    <Text accessibilityRole="link" style={{ color: c.primaryText }} onPress={() => Linking.openURL(`${config.webUrl}/privacy.html`)}>Privacy</Text>
                  </Text>
                  {subscribe.error ? <ErrorBox error={subscribe.error} /> : null}
                </>
              )}
            </Acc>
          ) : null}

          <Acc icon="headphones" title="When Ringo needs something" sub={INFO_SUB[d?.infoMode ?? "prompt"]} {...section("calls")}>
            <Text style={[s.muted, { marginBottom: 10 }]}>
              Ringo only knows your name, phone and address. If the business asks for something else, like an account number, PIN or how many people, or Ringo needs your OK on an offer, how should it reach you?
            </Text>
            <Choice<InfoMode> label="How Ringo reaches you mid-call" value={d?.infoMode ?? "prompt"} onChange={(m) => infoMode.mutate(m)}
              options={[
                { value: "prompt", label: "App", icon: "smartphone" },
                ...(d?.messaging.sms || d?.infoMode === "sms" ? [{ value: "sms" as const, label: "SMS", icon: "msg" as const }] : []),
                ...(d?.messaging.whatsapp || d?.infoMode === "whatsapp" ? [{ value: "whatsapp" as const, label: "WhatsApp", icon: "msg" as const }] : []),
                { value: "conference", label: "Call me in", icon: "phone" },
              ]} />
            <Text style={[s.meta, { marginTop: 4 }]}>
              {d?.infoMode === "conference"
                ? `Ringo calls ${d?.phone ? fmtPhone(d.phone) : "your phone"}, tells you what the rep needs, and connects you. Offers and texted codes are still asked in the app.`
                : d?.infoMode === "sms" || d?.infoMode === "whatsapp"
                  ? `Ringo texts ${d?.phone ? fmtPhone(d.phone) : "your verified phone"} on ${d.infoMode === "sms" ? "SMS" : "WhatsApp"}. Just reply, no need to open the app: type the answer, or 1 accept / 2 decline / 3 join / 4 end for offers. Ringo deletes both messages once it's passed your answer on. You still get the app notification too.`
                  : "You get a notification with the question and type the answer. Ringo passes it on and doesn't keep it."}
              {" "}If you don't answer within 2 minutes, Ringo politely ends the call and you can try again later.
            </Text>
            {d?.infoMode === "whatsapp" && d.messaging.whatsappJoin && d.messaging.whatsappNumber ? (
              <View style={[s.item, { marginTop: 10, marginBottom: 0, gap: 6 }]}>
                <Meta><Icon name="alert" size={14} color={c.warn} /><MetaText color={c.warn}>One-time step for WhatsApp</MetaText></Meta>
                <Text selectable style={{ color: c.text, fontSize: 13 }}>
                  Send "{d.messaging.whatsappJoin}" on WhatsApp to {fmtPhone(d.messaging.whatsappNumber)} so Ringo can message you.
                </Text>
                <Button slim kind="secondary" icon="msg" title="Open WhatsApp"
                  onPress={() => Linking.openURL(`https://wa.me/${d.messaging.whatsappNumber!.replace(/\D/g, "")}?text=${encodeURIComponent(d.messaging.whatsappJoin!)}`)} />
              </View>
            ) : null}
            {(d?.infoMode === "sms" || d?.infoMode === "whatsapp") && !d.phoneVerified ? (
              <Meta style={{ marginTop: 8 }}><Icon name="alert" size={12} color={c.warn} /><MetaText color={c.warn}>Verify your phone in Profile first, or Ringo will ask in the app instead.</MetaText></Meta>
            ) : null}
            {infoMode.error ? <ErrorBox error={infoMode.error} /> : null}
          </Acc>

          <Acc icon="cal" title="Google Calendar"
            sub={d?.calendar.connected ? d.calendar.email ?? "Connected" : "Let Ringo book around your schedule"}
            right={d?.calendar.connected ? <Pill text="Connected" icon="check" color={c.ok} bg={c.okSoft} /> : undefined} {...section("calendar")}>
            {!d?.calendar.available ? (
              <Text style={s.muted}>Calendar connection isn't switched on yet.</Text>
            ) : d.calendar.connected ? (
              <>
                <Meta style={{ marginBottom: 10 }}><Icon name="check-circle" size={14} color={c.ok} /><MetaText>Connected as {d.calendar.email ?? "your Google account"}</MetaText></Meta>
                <Text style={[s.label, { marginBottom: 6 }]}>Check my availability</Text>
                <Seg<"on" | "off"> label="Check my availability" value={d.calendar.check ? "on" : "off"} onChange={(v) => calPref.mutate({ calendarCheck: v === "on" })}
                  options={[{ value: "on", label: "On", icon: "check" }, { value: "off", label: "Off", icon: "x" }]} />
                <Text style={[s.meta, { marginTop: 6, marginBottom: 12 }]}>
                  When booking, Ringo checks whether you're free before agreeing to a time. It only sees busy and free, not your event details.
                </Text>
                <Text style={[s.label, { marginBottom: 6 }]}>Save bookings to my calendar</Text>
                <Seg<"on" | "off"> label="Save bookings to my calendar" value={d.calendar.save ? "on" : "off"} onChange={(v) => calPref.mutate({ calendarSave: v === "on" })}
                  options={[{ value: "on", label: "On", icon: "check" }, { value: "off", label: "Off", icon: "x" }]} />
                <Text style={[s.meta, { marginTop: 6, marginBottom: 12 }]}>
                  When Ringo books an appointment or reservation, it adds the event to your primary calendar with the reference number.
                </Text>
                {calPref.error ? <ErrorBox error={calPref.error} /> : null}
                <Button title="Disconnect" icon="x" kind="ghost" slim busy={disconnectCal.isPending}
                  onPress={async () => { if (await confirm("Disconnect Google Calendar? Ringo won't check or add events anymore.", "Disconnect")) disconnectCal.mutate(); }} />
                {disconnectCal.error ? <ErrorBox error={disconnectCal.error} /> : null}
              </>
            ) : (
              <>
                <Text style={[s.muted, { marginBottom: 10 }]}>
                  Connect your Google Calendar so Ringo can pick a time you're free when it books something, and add the booking to your calendar. You can turn either off later.
                </Text>
                <Button title="Connect Google Calendar" icon="cal" busy={connectCal.isPending} onPress={() => connectCal.mutate()} />
                {connectCal.error ? <ErrorBox error={connectCal.error} /> : null}
              </>
            )}
          </Acc>

          <Acc icon="signal" title="Your Ringo line" sub={d?.ringoNumber ? fmtPhone(d.ringoNumber) : "No number yet"}
            right={d?.forwardingActive ? <Pill text="Forwarding" icon="check" color={c.ok} bg={c.okSoft} /> : undefined} {...section("line")}>
            {d?.ringoNumber ? (
              <>
                <View style={[s.item, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                  <Icon name="smartphone" color={c.primaryText} />
                  <Text selectable style={{ color: c.text, fontWeight: "800", fontSize: 17, flex: 1, fontVariant: ["tabular-nums"] }}>{fmtPhone(d.ringoNumber)}</Text>
                  <IconBtn icon="copy" label="Copy Ringo number" size={34} onPress={async () => { await Clipboard.setStringAsync(d.ringoNumber!); toast("copy", "Number copied"); }} />
                </View>
                <Pressable onPress={() => router.push("/forwarding")} accessibilityRole="button" style={[s.item, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                  <Icon name="forward" color={d.forwardingActive ? c.ok : c.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: c.text, fontWeight: "700" }}>Call forwarding</Text>
                    <Text style={s.meta}>{d.forwardingActive ? "On · Ringo answers calls you miss" : "Off · set it up in about a minute"}</Text>
                  </View>
                  <Icon name="right" size={16} color={c.muted} />
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => router.push("/forwarding")} accessibilityRole="button" style={[s.item, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                <Icon name="plus" color={c.primaryText} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontWeight: "700" }}>Get your assistant number</Text>
                  <Text style={s.meta}>Your own number for Ringo to answer missed calls</Text>
                </View>
                <Icon name="right" size={16} color={c.muted} />
              </Pressable>
            )}
          </Acc>

          <Acc icon="gear" title="Account" sub={d?.email} {...section("account")}>
            {d?.isAdmin ? <Button title="Dashboard" icon="trend" kind="secondary" onPress={() => router.push("/admin")} /> : null}
            <Button title="Send feedback" icon="star" kind="secondary" onPress={() => router.push("/feedback")} />
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 4 }}>
              <Text accessibilityRole="link" style={[s.meta, { color: c.primaryText }]} onPress={() => Linking.openURL("mailto:support@ringo.app")}>Help & support</Text>
              <Text accessibilityRole="link" style={[s.meta, { color: c.primaryText }]} onPress={() => Linking.openURL(`${config.webUrl}/privacy.html`)}>Privacy</Text>
              <Text accessibilityRole="link" style={[s.meta, { color: c.primaryText }]} onPress={() => Linking.openURL(`${config.webUrl}/terms.html`)}>Terms</Text>
            </View>
            <Text style={[s.meta, { textAlign: "center" }]}>Ringo {Constants.expoConfig?.version ?? ""}</Text>
            <Button title="Sign out" icon="back" kind="ghost" onPress={signOut} />
            <Button title="Delete my account" icon="trash" kind="danger" busy={delMe.isPending}
              onPress={async () => { if (await confirm("This permanently deletes your profile, call history, messages and recordings. It can't be undone.")) delMe.mutate(); }} />
            {delMe.error ? <ErrorBox error={delMe.error} /> : null}
          </Acc>
        </ScrollView>
      )}
    </View>
  );
}
