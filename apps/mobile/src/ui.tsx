// Shared UI kit. Look and feel ported from the prototype (docs/prototype.html, also https://ringocall.netlify.app).
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SvgXml } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PROVIDERS } from "@ringo/shared";
import { ICONS, type IconName } from "./icons.ts";
import { c, radius, space } from "./theme.ts";

export type { IconName };

// ---------- Primitives ----------

export function Icon({ name, size = 20, color = c.text, strokeWidth = 2, fill }: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill ?? "none"}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <SvgXml xml={xml} width={size} height={size} />
    </View>
  );
}

/** Brand gradient (#5b5ce6 → #9333ea, 135°). */
export function Grad({ style, children }: { style?: ViewStyle | ViewStyle[]; children?: ReactNode }) {
  return <LinearGradient colors={[c.gradFrom, c.gradTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>{children}</LinearGradient>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle | ViewStyle[] }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function H({ children }: { children: ReactNode }) {
  return <Text style={s.h} accessibilityRole="header">{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}

/** Small uppercase heading inside forms ("WHO", "WHAT", "PRIORITY"…). */
export function StepLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: space(3.5), marginBottom: space(2) }}>
      <Text style={s.step}>{children}</Text>
      {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
    </View>
  );
}

/** Inline meta row: icon + text pieces. */
export function Meta({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }, style]}>{children}</View>;
}
export const MetaText = ({ children, color }: { children: ReactNode; color?: string }) => <Text style={[s.meta, color ? { color, fontWeight: "700" } : null]}>{children}</Text>;

// ---------- Buttons ----------

type BtnKind = "primary" | "secondary" | "ghost" | "danger";
export function Button({ title, onPress, kind = "primary", icon, disabled, busy, slim }: {
  title: string; onPress: () => void; kind?: BtnKind; icon?: IconName; disabled?: boolean; busy?: boolean; slim?: boolean;
}) {
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? c.bad : c.primaryText;
  const inner = (
    <>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={slim ? 16 : 18} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: "700", fontSize: slim ? 14 : 16 }}>{title}</Text>
    </>
  );
  const box: ViewStyle[] = [s.btn, slim ? s.btnSlim : {}, kind === "secondary" ? { backgroundColor: c.primarySoft } : {}, kind === "ghost" ? s.btnGhost : {}, kind === "danger" ? { backgroundColor: c.badSoft } : {}];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }} onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [{ marginTop: slim ? space(2.5) : space(4), borderRadius: 14, overflow: "hidden" }, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
      {kind === "primary" ? <Grad style={box}>{inner}</Grad> : <View style={box}>{inner}</View>}
    </Pressable>
  );
}

/** Square icon button (gear, back, copy, trash…). */
export function IconBtn({ icon, label, onPress, variant = "default", size = 40, dot, disabled }: {
  icon: IconName; label: string; onPress: () => void; variant?: "default" | "ghost" | "grad"; size?: number; dot?: boolean; disabled?: boolean;
}) {
  const color = variant === "grad" ? "#fff" : variant === "ghost" ? c.muted : c.text;
  const box: ViewStyle = { width: size, height: size, borderRadius: size > 36 ? 12 : 10, alignItems: "center", justifyContent: "center" };
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [box, variant === "default" && { backgroundColor: c.card, borderWidth: 1, borderColor: c.border }, pressed && { backgroundColor: c.card2 }, disabled && { opacity: 0.5 }, { overflow: "hidden" }]}>
      {variant === "grad" ? <Grad style={[box, { position: "absolute" }]} /> : null}
      <Icon name={icon} size={size > 36 ? 20 : 16} color={color} />
      {dot ? <View style={{ position: "absolute", top: 7, right: 7, width: 8, height: 8, borderRadius: 4, backgroundColor: c.amber, borderWidth: 2, borderColor: c.card }} /> : null}
    </Pressable>
  );
}

// ---------- Inputs ----------

/** Text field with a leading icon (label is read by screen readers, shown as placeholder). */
export function Field({ label, icon, error, style, ...props }: TextInputProps & { label: string; icon?: IconName; error?: string; style?: ViewStyle }) {
  return (
    <View style={[{ marginTop: space(2) }, style]}>
      {icon ? <View style={{ position: "absolute", left: 12, top: 13, zIndex: 1 }}><Icon name={icon} size={18} color={c.muted} /></View> : null}
      <TextInput accessibilityLabel={label} placeholder={props.placeholder ?? label} placeholderTextColor={c.muted}
        style={[s.input, !icon && { paddingLeft: 12 }, props.multiline && { minHeight: 64, textAlignVertical: "top" }, error ? { borderColor: c.bad } : null]} {...props} />
      {error ? <Text style={{ color: c.bad, fontSize: 13, marginTop: 4 }} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

export type SegOption<T extends string> = { value: T; label: string; icon?: IconName; tone?: { color: string; bg: string; ring: string } };

/** Segmented control (priority, when, ask-me…). */
export function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void }) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        const fg = on ? (o.tone?.color ?? c.text) : c.muted;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label}
            style={[s.segBtn, on && { backgroundColor: o.tone?.bg ?? c.card2, borderColor: o.tone?.ring ?? c.border2 }]}>
            {o.icon ? <Icon name={o.icon} size={16} color={fg} /> : null}
            <Text style={{ color: fg, fontWeight: "600", fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Filter chips (gradient when selected). */
export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <View style={[s.row, { marginBottom: 10 }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label} onPress={() => onChange(o.value)}
            style={[s.fchip, on && { borderColor: "transparent", overflow: "hidden" }]}>
            {on ? <Grad style={StyleSheet.absoluteFill as ViewStyle} /> : null}
            {o.icon ? <Icon name={o.icon} size={14} color={on ? "#fff" : c.muted} /> : null}
            <Text style={{ color: on ? "#fff" : c.muted, fontWeight: "600", fontSize: 12 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Brand bits ----------

const MONO: Record<string, string> = { att: "AT&T", verizon: "V", tmobile: "T", xfinity: "X", spectrum: "S" };

/** Provider logo tile: colored square with monogram; unknown/custom gets the gradient + store icon. */
export function Avatar({ providerId, size = 48, round }: { providerId: string; size?: number; round?: boolean }) {
  const p = PROVIDERS.find((x) => x.id === providerId);
  const box: ViewStyle = { width: size, height: size, borderRadius: round ? size / 2 : size * 0.31, alignItems: "center", justifyContent: "center", overflow: "hidden" };
  if (!p) return <Grad style={box}><Icon name="store" size={size * 0.42} color="#fff" /></Grad>;
  const mono = MONO[p.id] ?? p.name[0]!;
  return (
    <View style={[box, { backgroundColor: p.color }]}>
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: mono.length > 2 ? size * 0.23 : size * 0.3, letterSpacing: -0.3 }}>{mono}</Text>
    </View>
  );
}

/** Initials in a gradient circle (profile). */
export function Initials({ name, size = 64 }: { name: string; size?: number }) {
  const ini = name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return <Grad style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "800", fontSize: size * 0.28 }}>{ini}</Text></Grad>;
}

/** Selectable logo tiles (provider / carrier). */
export function Tiles({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 4 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label}
            style={{ width: 54, alignItems: "center", gap: 6 }}>
            <View style={[{ borderRadius: 17, padding: 2, borderWidth: 2, borderColor: on ? c.primary : "transparent" }, on && { transform: [{ scale: 1.05 }] }]}>
              {o.value === "custom"
                ? <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: c.card2, alignItems: "center", justifyContent: "center" }}><Icon name="plus" color={c.primaryText} /></View>
                : <Avatar providerId={o.value} size={44} />}
            </View>
            <Text style={{ fontSize: 11, color: on ? c.text : c.muted, fontWeight: on ? "700" : "400" }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small rounded status pill. iconOnly shows just the icon (label still read aloud). */
export function Pill({ text, color, bg, icon, iconOnly }: { text: string; color: string; bg: string; icon?: IconName; iconOnly?: boolean }) {
  return (
    <View style={[s.pill, { backgroundColor: bg }]} accessible accessibilityLabel={text}>
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      {iconOnly ? null : <Text style={{ color, fontSize: 11, fontWeight: "700" }}>{text}</Text>}
    </View>
  );
}

export function Count({ n }: { n: number }) {
  return <Text style={s.count}>{n}</Text>;
}

/** Stat tile in the 3-up metrics row. */
export function Stat({ icon, value, label, color = c.primaryText }: { icon: IconName; value: string | number; label: string; color?: string }) {
  return (
    <View style={s.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} color={color} />
      <Text style={{ color: c.text, fontSize: 18, fontWeight: "700", marginTop: 4 }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}
export const Stats = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", gap: 8, marginTop: 8, marginBottom: 10 }}>{children}</View>;

/** Small chip under a list item ("12m", "41m hold saved", "#REF"). */
export function Chip({ icon, text, tone }: { icon: IconName; text: string; tone?: "ok" | "act" }) {
  const color = tone === "ok" ? c.ok : tone === "act" ? c.primaryText : c.muted;
  const border = tone === "ok" ? "rgba(52,211,153,.3)" : tone === "act" ? "rgba(124,108,246,.45)" : c.border;
  return (
    <View style={[s.chipS, { borderColor: border }]}>
      <Icon name={icon} size={12} color={color} />
      <Text style={{ color, fontSize: 11, fontWeight: tone === "act" ? "700" : "400" }}>{text}</Text>
    </View>
  );
}

/** Round outcome / call-type badge. */
export function Badge({ icon, color, bg, label }: { icon: IconName; color: string; bg: string; label: string }) {
  return <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: bg, alignItems: "center", justifyContent: "center" }} accessible accessibilityLabel={label}><Icon name={icon} color={color} /></View>;
}

// ---------- Accordion ----------

/** Tracks which one section in a group is open. Everything starts collapsed; opening one closes the rest. */
export function useAccordion<K extends string>() {
  const [open, setOpen] = useState<K | null>(null);
  const get = (key: K) => ({ open: open === key, onToggle: () => setOpen((cur) => (cur === key ? null : key)) });
  return Object.assign(get, { openOnly: (key: K) => setOpen(key) });
}

/** Collapsible card: icon box, title + subtitle, optional count/pill, chevron. */
export function Acc({ icon, title, sub, right, open, onToggle, children, style }: {
  icon: IconName; title: string; sub?: ReactNode; right?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; style?: ViewStyle;
}) {
  return (
    <View style={[s.acc, open && { borderColor: c.borderOpen }, style]}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 }, pressed && { opacity: 0.85 }]}>
        <View style={{ width: 38, height: 38, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: c.primarySoft }}>
          {open ? <Grad style={StyleSheet.absoluteFill as ViewStyle} /> : null}
          <Icon name={icon} color={open ? "#fff" : c.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: c.text, fontWeight: "800", fontSize: 15 }}>{title}</Text>
          {sub ? (typeof sub === "string" ? <Text style={[s.meta, { marginTop: 2 }]} numberOfLines={1}>{sub}</Text> : <View style={{ marginTop: 2 }}>{sub}</View>) : null}
        </View>
        {right}
        <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}><Icon name="chev" size={18} color={c.muted} /></View>
      </Pressable>
      {open ? <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 }}>{children}</View> : null}
    </View>
  );
}

// ---------- Page header ----------

/** Header for pushed screens (settings, call, forwarding): back button + title + optional action. */
export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: Math.max(14, insets.top), paddingBottom: 10, backgroundColor: c.bg }}>
      <IconBtn icon="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontSize: 18, fontWeight: "800" }} accessibilityRole="header" numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.meta} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------- States ----------

export function Empty({ text, icon = "history" }: { text: string; icon?: IconName }) {
  return (
    <View style={s.empty}>
      <View style={{ opacity: 0.7, marginBottom: 6 }}><Icon name={icon} size={30} color={c.muted} /></View>
      <Text style={{ color: c.muted, fontSize: 13, textAlign: "center" }}>{text}</Text>
    </View>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }} accessibilityRole="alert">
      <Icon name="alert" size={16} color={c.bad} />
      <Text style={{ color: c.bad, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={{ gap: 4 }}>
      <ErrorLine text={error instanceof Error ? error.message : "Something went wrong"} />
      {onRetry ? <Button title="Try again" kind="secondary" icon="refresh" slim onPress={onRetry} /> : null}
    </View>
  );
}

export const Loading = () => <ActivityIndicator color={c.primary} style={{ padding: space(6) }} accessibilityLabel="Loading" />;

// ---------- Toast ----------

const ToastCtx = createContext<(icon: IconName, msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ icon: IconName; msg: string } | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((icon: IconName, msg: string) => {
    setT({ icon, msg });
    Animated.timing(op, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 250, useNativeDriver: false }).start(), 2600);
  }, [op]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t ? (
        <Animated.View pointerEvents="none" style={[s.toast, { opacity: op }]} accessibilityLiveRegion="polite">
          <Icon name={t.icon} size={14} color="#fff" />
          <Text style={{ color: "#fff", fontSize: 13 }}>{t.msg}</Text>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ---------- Styles ----------

export const s = StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: radius, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12, gap: space(2) },
  h: { color: c.text, fontSize: 18, fontWeight: "700" },
  muted: { color: c.muted, fontSize: 14 },
  meta: { color: c.muted, fontSize: 12 },
  label: { color: c.muted, fontSize: 13, fontWeight: "600" },
  step: { color: c.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: c.field, color: c.text, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingLeft: 40, paddingRight: 12, paddingVertical: 11, fontSize: 15 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, minHeight: 48 },
  btnSlim: { paddingVertical: 11, paddingHorizontal: 14, minHeight: 42 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: c.border },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  seg: { flexDirection: "row", gap: 4, backgroundColor: c.field, borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 4 },
  segBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 9, borderWidth: 1, borderColor: "transparent" },
  fchip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: c.border, backgroundColor: c.field, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  count: { backgroundColor: c.primarySoft, color: c.primaryText, fontSize: 12, fontWeight: "700", paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999, overflow: "hidden" },
  stat: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 10, alignItems: "center" },
  chipS: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.card, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  acc: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: radius, marginBottom: 10 },
  item: { backgroundColor: c.field, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12, marginBottom: 8 },
  empty: { alignItems: "center", paddingVertical: 18, paddingHorizontal: 10, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, borderRadius: 14 },
  toast: { position: "absolute", alignSelf: "center", bottom: 90, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#2a3150", borderWidth: 1, borderColor: c.border2, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999 },
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 28 },
});
