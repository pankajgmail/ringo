import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi } from "@/api.ts";
import { useAuth } from "@/auth.tsx";
import { Acc, Button, ErrorBox, Field, Icon, IconBtn, Initials, Loading, Meta, MetaText, PageHeader, Pill, s, useAccordion, useToast } from "@/ui.tsx";
import { fmtPhone, toE164 } from "@/format.ts";
import { c } from "@/theme.ts";

function confirm(msg: string) {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(msg));
  return new Promise<boolean>((res) => Alert.alert("Are you sure?", msg, [{ text: "Cancel", onPress: () => res(false) }, { text: "Delete", style: "destructive", onPress: () => res(true) }]));
}

export default function Settings() {
  const api = useApi();
  const toast = useToast();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const section = useAccordion<"profile" | "line" | "account">();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name); setEmail(me.data.email); setPhone(me.data.phone ?? ""); setAddress(me.data.address);
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.saveProfile({ name: name.trim(), email: email.trim(), phone: toE164(phone), address, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: () => { toast("check", "Profile saved"); qc.invalidateQueries({ queryKey: ["me"] }); },
  });
  const sendCode = useMutation({ mutationFn: () => api.startPhoneVerify(toE164(phone)), onSuccess: () => { setCodeSent(true); toast("msg", "Code sent"); } });
  const checkCode = useMutation({
    mutationFn: () => api.checkPhoneVerify(toE164(phone), code),
    onSuccess: () => { setCodeSent(false); setCode(""); toast("check-circle", "Phone verified"); qc.invalidateQueries({ queryKey: ["me"] }); },
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
            right={d && !(d.name && d.phoneVerified) ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.amber }} /> : undefined} {...section("profile")}>
            <Field label="Full name" icon="user" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
            <Field label="Mobile number" icon="phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
            <Field label="Email" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
            <Field label="Address with ZIP (used to find businesses near you)" icon="pin" value={address} onChangeText={setAddress} autoComplete="street-address" />
            {save.error ? <ErrorBox error={save.error} /> : null}
            <Button title="Save profile" icon="check" onPress={() => save.mutate()} busy={save.isPending} />

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

          <Acc icon="signal" title="Your Ringo line" sub={d?.ringoNumber ? fmtPhone(d.ringoNumber) : "Not assigned yet"}
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
            ) : <Text style={s.muted}>You'll get a Ringo number once your account is set up.</Text>}
          </Acc>

          <Acc icon="gear" title="Account" sub={d?.email} {...section("account")}>
            <Button title="Sign out" icon="back" kind="ghost" onPress={signOut} />
            <Button title="Delete my account" icon="trash" kind="danger" busy={delMe.isPending}
              onPress={async () => { if (await confirm("This deletes your profile, saved accounts and call history.")) delMe.mutate(); }} />
            {delMe.error ? <ErrorBox error={delMe.error} /> : null}
          </Acc>
        </ScrollView>
      )}
    </View>
  );
}
