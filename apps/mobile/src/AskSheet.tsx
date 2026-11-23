import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { useLive } from "./live.tsx";
import { useApi } from "./api.ts";
import { Button, ErrorLine, Field, Icon, s } from "./ui.tsx";
import { c, space } from "./theme.ts";

/** Mid-call prompt: approve an offer, or relay a one-time code the provider texted. */
export function AskSheet() {
  const { ask, dismissAsk } = useLive();
  const api = useApi();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!ask) return null;

  const send = async (choice: "accept" | "counter" | "takeover" | "end" | "reply") => {
    setBusy(true);
    setErr("");
    try {
      await api.answer(ask.callId, ask.askId, { choice, note: choice === "reply" ? code : undefined });
      setCode("");
      dismissAsk();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={dismissAsk}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.5)" }}>
        <View style={[s.card, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: space(5), gap: space(2), marginBottom: 0, maxWidth: 560, width: "100%", alignSelf: "center" }]} accessibilityViewIsModal>
          <View style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border2 }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.warnSoft, alignItems: "center", justifyContent: "center" }}><Icon name={ask.kind === "code" ? "hash" : "msg"} color={c.warn} /></View>
            <Text style={s.h} accessibilityRole="header">{ask.kind === "code" ? "Ringo needs a code" : "Ringo needs your decision"}</Text>
          </View>
          <Text style={{ color: c.text, fontSize: 16 }}>{ask.question}</Text>
          <Text style={s.muted}>Ringo is keeping the rep on the line. Answer within {Math.max(0, Math.round((new Date(ask.expiresAt).getTime() - Date.now()) / 1000))}s.</Text>
          {ask.kind === "code" ? (
            <>
              <Field label="Code from your text messages" icon="hash" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus />
              <Button title="Send code" icon="check" onPress={() => send("reply")} disabled={!code} busy={busy} />
            </>
          ) : (
            <>
              <Button title="Accept" icon="check" onPress={() => send("accept")} busy={busy} />
              <Button title="Push for more" icon="trend" kind="secondary" onPress={() => send("counter")} disabled={busy} />
              <Button title="I'll take over" icon="headphones" kind="ghost" onPress={() => send("takeover")} disabled={busy} />
              <Button title="End the call" icon="phone-off" kind="danger" onPress={() => send("end")} disabled={busy} />
            </>
          )}
          {err ? <ErrorLine text={err} /> : null}
        </View>
      </View>
    </Modal>
  );
}
