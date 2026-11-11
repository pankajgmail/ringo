import { useState } from "react";
import { Modal, Text, View } from "react-native";
import { useLive } from "./live.tsx";
import { useApi } from "./api.ts";
import { Button, Field, s } from "./ui.tsx";
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
        <View style={[s.card, { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, padding: space(5), gap: space(4) }]} accessibilityViewIsModal>
          <Text style={s.h} accessibilityRole="header">{ask.kind === "code" ? "Ringo needs a code" : "Ringo needs your decision"}</Text>
          <Text style={{ color: c.text, fontSize: 16 }}>{ask.question}</Text>
          <Text style={s.muted}>Ringo is keeping the rep on the line. Answer within {Math.max(0, Math.round((new Date(ask.expiresAt).getTime() - Date.now()) / 1000))}s.</Text>
          {ask.kind === "code" ? (
            <>
              <Field label="Code from your text messages" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus />
              <Button title="Send code" onPress={() => send("reply")} disabled={!code} busy={busy} />
            </>
          ) : (
            <>
              <Button title="Accept" onPress={() => send("accept")} busy={busy} />
              <Button title="Push for more" kind="ghost" onPress={() => send("counter")} disabled={busy} />
              <Button title="I'll take over" kind="ghost" onPress={() => send("takeover")} disabled={busy} />
              <Button title="End the call" kind="danger" onPress={() => send("end")} disabled={busy} />
            </>
          )}
          {err ? <Text style={{ color: c.bad }} accessibilityRole="alert">{err}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}
