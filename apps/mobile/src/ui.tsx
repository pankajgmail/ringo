import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { c, radius, space } from "./theme.ts";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H({ children }: { children: ReactNode }) {
  return <Text style={s.h} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

export function Button({ title, onPress, kind = "primary", disabled, busy }: { title: string; onPress: () => void; kind?: "primary" | "ghost" | "danger"; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.btn, kind === "ghost" && s.btnGhost, kind === "danger" && s.btnDanger, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={[s.btnText, kind === "ghost" && { color: c.primaryText }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: space(1) }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} style={[s.input, error ? { borderColor: c.bad } : null]} {...props} />
      {error ? <Text style={{ color: c.bad, fontSize: 13 }} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

/** Segmented single-choice control (call type, priority, carrier…). */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; color?: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ gap: space(1) }}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)}
              style={[s.chip, on && { backgroundColor: c.primarySoft, borderColor: o.color ?? c.primary }]}>
              <Text style={{ color: on ? (o.color ?? c.primaryText) : c.muted, fontWeight: "600" }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <Text style={[s.pill, { color, backgroundColor: bg }]}>{text}</Text>;
}

export function Empty({ text }: { text: string }) {
  return <Text style={[s.muted, { textAlign: "center", paddingVertical: space(6) }]}>{text}</Text>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: c.bad }}>
      <Text style={{ color: c.bad }} accessibilityRole="alert">{error instanceof Error ? error.message : "Something went wrong"}</Text>
      {onRetry ? <Button title="Try again" kind="ghost" onPress={onRetry} /> : null}
    </Card>
  );
}

export const Loading = () => <ActivityIndicator color={c.primary} style={{ padding: space(6) }} accessibilityLabel="Loading" />;

export const s = StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: radius, borderWidth: 1, borderColor: c.border, padding: space(4), gap: space(3) },
  h: { color: c.text, fontSize: 18, fontWeight: "700" },
  muted: { color: c.muted, fontSize: 14 },
  label: { color: c.muted, fontSize: 13, fontWeight: "600" },
  input: { backgroundColor: c.field, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: space(3), paddingVertical: space(3), fontSize: 16 },
  btn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: space(3.5), alignItems: "center", minHeight: 48, justifyContent: "center" },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.border },
  btnDanger: { backgroundColor: c.bad },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: space(3.5), paddingVertical: space(2), minHeight: 40, justifyContent: "center" },
  pill: { fontSize: 12, fontWeight: "700", paddingHorizontal: space(2), paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: space(4), gap: space(4), paddingBottom: space(16) },
});
