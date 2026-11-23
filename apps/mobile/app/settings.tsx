import { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CARRIERS, PROVIDERS, type Carrier } from "@ringo/shared";
import { useApi } from "@/api.ts";
import { useAuth } from "@/auth.tsx";
import { Button, Card, Choice, ErrorBox, Field, H, Loading, Muted, s } from "@/ui.tsx";
import { toE164 } from "@/format.ts";
import { c, space } from "@/theme.ts";

const CARRIER_LABEL: Record<Carrier, string> = { att: "AT&T", tmobile: "T-Mobile", verizon: "Verizon" };

function confirm(msg: string) {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(msg));
  return new Promise<boolean>((res) => Alert.alert("Are you sure?", msg, [{ text: "Cancel", onPress: () => res(false) }, { text: "Delete", style: "destructive", onPress: () => res(true) }]));
}

export default function Settings() {
  const api = useApi();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [carrier, setCarrier] = useState<Carrier>("att");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  useEffect(() => {
    if (!me.data) return;
    setName(me.data.name); setEmail(me.data.email); setPhone(me.data.phone ?? ""); setAddress(me.data.address); setCarrier(me.data.carrier);
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.saveProfile({ name, email, phone: toE164(phone), address, carrier, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const sendCode = useMutation({ mutationFn: () => api.startPhoneVerify(toE164(phone)), onSuccess: () => setCodeSent(true) });
  const checkCode = useMutation({ mutationFn: () => api.checkPhoneVerify(toE164(phone), code), onSuccess: () => { setCodeSent(false); qc.invalidateQueries({ queryKey: ["me"] }); } });

  const [acctProvider, setAcctProvider] = useState("att");
  const [acctNumber, setAcctNumber] = useState("");
  const [acctPin, setAcctPin] = useState("");
  const saveAcct = useMutation({
    mutationFn: () => api.saveAccount({ providerId: acctProvider, accountNumber: acctNumber, pin: acctPin || undefined, holderName: name || undefined }),
    onSuccess: () => { setAcctNumber(""); setAcctPin(""); qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
  const delAcct = useMutation({ mutationFn: api.deleteAccount, onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }) });
  const delMe = useMutation({ mutationFn: api.deleteMe, onSuccess: () => signOut() });

  if (me.isLoading) return <Loading />;
  if (me.error) return <View style={s.scroll}><ErrorBox error={me.error} onRetry={me.refetch} /></View>;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Card>
        <H>Your profile</H>
        <Muted>Ringo uses this to identify you to providers.</Muted>
        <Field label="Full name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
        <Field label="Address" value={address} onChangeText={setAddress} autoComplete="street-address" />
        <Choice label="Mobile carrier" value={carrier} onChange={setCarrier} options={CARRIERS.map((v) => ({ value: v, label: CARRIER_LABEL[v] }))} />
        {save.error ? <ErrorBox error={save.error} /> : null}
        <Button title="Save profile" onPress={() => save.mutate()} busy={save.isPending} />
        {save.isSuccess ? <Text style={{ color: c.ok }} accessibilityLiveRegion="polite">Saved</Text> : null}

        {me.data?.phone && !me.data.phoneVerified ? (
          <View style={{ gap: space(2) }}>
            <Text style={{ color: c.warn }}>Verify {me.data.phone} to start making calls.</Text>
            {codeSent ? (
              <>
                <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" />
                <Button title="Verify" onPress={() => checkCode.mutate()} busy={checkCode.isPending} disabled={code.length < 4} />
                {checkCode.error ? <ErrorBox error={checkCode.error} /> : null}
              </>
            ) : <Button title="Text me a code" kind="ghost" onPress={() => sendCode.mutate()} busy={sendCode.isPending} />}
            {sendCode.error ? <ErrorBox error={sendCode.error} /> : null}
          </View>
        ) : me.data?.phoneVerified ? <Text style={{ color: c.ok }}>Mobile number verified</Text> : null}
      </Card>

      <Card>
        <H>Provider accounts</H>
        <Muted>Encrypted. Ringo only reads an account during a call to that provider, and every read is logged.</Muted>
        {accounts.data?.map((a) => (
          <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: c.text }}>{PROVIDERS.find((p) => p.id === a.providerId)?.name ?? a.providerId} ···{a.accountNumberLast4}{a.hasPin ? " · PIN saved" : ""}</Text>
            <Text style={{ color: c.bad, fontWeight: "600" }} accessibilityRole="button" onPress={() => delAcct.mutate(a.id)}>Remove</Text>
          </View>
        ))}
        <Choice label="Provider" value={acctProvider} onChange={setAcctProvider} options={PROVIDERS.map((p) => ({ value: p.id, label: p.name, color: p.color }))} />
        <Field label="Account number" value={acctNumber} onChangeText={setAcctNumber} autoCapitalize="none" />
        <Field label="Account PIN (optional)" value={acctPin} onChangeText={setAcctPin} secureTextEntry keyboardType="number-pad" />
        {saveAcct.error ? <ErrorBox error={saveAcct.error} /> : null}
        <Button title="Save account" kind="ghost" onPress={() => saveAcct.mutate()} busy={saveAcct.isPending} disabled={!acctNumber} />
      </Card>

      <Card>
        <H>Account</H>
        <Button title="Sign out" kind="ghost" onPress={signOut} />
        <Button title="Delete my account" kind="danger" busy={delMe.isPending} onPress={async () => { if (await confirm("This deletes your profile, saved accounts and call history.")) delMe.mutate(); }} />
      </Card>
    </ScrollView>
  );
}
