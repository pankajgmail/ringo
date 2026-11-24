import { useEffect, useState } from "react";
import { Modal, Text, View } from "react-native";
import { useLive } from "./live.tsx";
import { useApi } from "./api.ts";
import { Button, ErrorLine, Field, Icon, s } from "./ui.tsx";
import { c, space } from "./theme.ts";

const secondsLeft = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
const fmtLeft = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : `${n}s`);

const TITLES = { decision: "Ringo needs your decision", code: "Ringo needs a code", info: "Ringo needs some information" } as const;

/** Mid-call prompt: approve an offer, relay a texted code, or give a detail Ringo doesn't have (account number, PIN, party size). */
export function AskSheet() {
  const { ask, dismissAsk } = useLive();
  const api = useApi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!ask) return;
    setLeft(secondsLeft(ask.expiresAt));
    const t = setInterval(() => setLeft(secondsLeft(ask.expiresAt)), 1000);
    return () => clearInterval(t);
  }, [ask]);

  if (!ask) return null;
  const expired = left === 0;

  const send = async (choice: "accept" | "counter" | "takeover" | "end" | "reply") => {
    setBusy(true);
    setErr("");
    try {
      await api.answer(ask.callId, ask.askId, { choice, note: choice === "reply" ? text.trim() : undefined });
      setText("");
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
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.warnSoft, alignItems: "center", justifyContent: "center" }}><Icon name={ask.kind === "decision" ? "msg" : "hash"} color={c.warn} /></View>
            <Text style={s.h} accessibilityRole="header">{TITLES[ask.kind]}</Text>
          </View>
          <Text style={{ color: c.text, fontSize: 16 }}>{ask.question}</Text>
          <Text style={s.muted} accessibilityLiveRegion="polite">
            {expired ? "Time's up. Ringo is wrapping up the call." : `Ringo is keeping the rep on the line. Answer within ${fmtLeft(left)}, or Ringo will end the call.`}
          </Text>
          {ask.kind === "decision" ? (
            <>
              <Button title="Accept" icon="check" onPress={() => send("accept")} busy={busy} disabled={expired} />
              <Button title="Push for more" icon="trend" kind="secondary" onPress={() => send("counter")} disabled={busy || expired} />
              <Button title="I'll take over" icon="headphones" kind="ghost" onPress={() => send("takeover")} disabled={busy || expired} />
              <Button title="End the call" icon="phone-off" kind="danger" onPress={() => send("end")} disabled={busy || expired} />
            </>
          ) : (
            <>
              {ask.kind === "code"
                ? <Field label="Code from your text messages" icon="hash" value={text} onChangeText={setText} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" autoFocus />
                : <Field label="Your answer" icon="msg" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} autoComplete="off" autoFocus />}
              <Text style={s.meta}>Ringo passes this to the rep and doesn't keep it.</Text>
              <Button title="Send" icon="check" onPress={() => send("reply")} disabled={!text.trim() || expired} busy={busy} />
              <Button title="Call me in instead" icon="phone" kind="secondary" onPress={() => send("takeover")} disabled={busy || expired} />
              <Button title="End the call" icon="phone-off" kind="danger" onPress={() => send("end")} disabled={busy || expired} />
            </>
          )}
          {err ? <ErrorLine text={err} /> : null}
        </View>
      </View>
    </Modal>
  );
}
