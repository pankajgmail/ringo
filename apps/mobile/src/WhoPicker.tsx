import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useApi, type PlaceHit } from "./api.ts";
import { pickContact } from "./contacts.ts";
import { Avatar, ErrorLine, Field, Icon, Initials, Meta, MetaText, Pill, Seg, s } from "./ui.tsx";
import { fmtPhone } from "./format.ts";
import { c } from "./theme.ts";

export type WhoMode = "provider" | "contact" | "other";
/** What the form sends: a known brand id, or a name + number. */
export type Who = { providerId: string; name: string; number: string; address?: string } | null;

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

/** ZIP from the saved address, else the whole address. */
export const nearFrom = (address?: string) => address?.match(/\b\d{5}\b/)?.[0] ?? address?.trim() ?? "";

function Chosen({ who, mode, onClear }: { who: NonNullable<Who>; mode: WhoMode; onClear: () => void }) {
  return (
    <View style={[s.item, { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, marginBottom: 0, borderColor: c.primary, backgroundColor: "#1b1f3b" }]}>
      {mode === "contact" ? <Initials name={who.name} size={38} /> : <Avatar providerId={who.providerId} size={38} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: c.text, fontWeight: "700" }} numberOfLines={1}>{who.name}</Text>
        <Meta style={{ marginTop: 2 }}><Icon name="phone" size={12} color={c.muted} /><MetaText>{fmtPhone(who.number)}{who.address ? ` · ${who.address}` : ""}</MetaText></Meta>
      </View>
      <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel={`Change, ${who.name} selected`} hitSlop={8}>
        <Text style={{ color: c.primaryText, fontWeight: "700", fontSize: 13 }}>Change</Text>
      </Pressable>
    </View>
  );
}

export function WhoPicker({ mode, onMode, who, onWho, defaultNear }: { mode: WhoMode; onMode: (m: WhoMode) => void; who: Who; onWho: (w: Who) => void; defaultNear: string }) {
  const api = useApi();
  const [q, setQ] = useState("");
  const [near, setNear] = useState(defaultNear);
  const [editNear, setEditNear] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [contactErr, setContactErr] = useState("");
  useEffect(() => { if (!near && defaultNear) setNear(defaultNear); }, [defaultNear]); // eslint-disable-line react-hooks/exhaustive-deps

  const dq = useDebounced(q.trim());
  const dnear = useDebounced(near.trim());
  const search = useQuery({ queryKey: ["places", dq, dnear], queryFn: () => api.places(dq, dnear || undefined), enabled: mode === "provider" && !who && dq.length >= 2, staleTime: 5 * 60_000 });

  // "Other": the typed name + number is the selection.
  useEffect(() => {
    if (mode === "other") onWho(name.trim() || number.trim() ? { providerId: "custom", name: name.trim(), number } : null);
  }, [mode, name, number]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m: WhoMode) => { onMode(m); onWho(null); setContactErr(""); };
  const choose = (p: PlaceHit) => onWho({ providerId: p.providerId ?? "custom", name: p.providerId ? p.name.replace(/ customer service$/, "") : p.name, number: p.number, address: p.kind === "place" ? p.address : undefined });

  const openContacts = async () => {
    setContactErr("");
    try {
      const r = await pickContact();
      if (r === "unsupported") setContactErr("This browser can't open your contacts. Use the Ringvo app on your phone, or choose Other and type the number.");
      else if (r) onWho({ providerId: "custom", name: r.name, number: r.number });
    } catch {
      setContactErr("Couldn't open your contacts. Check that Ringvo is allowed to use them.");
    }
  };

  return (
    <View>
      <Seg<WhoMode> label="Who should Ringvo call" value={mode} onChange={switchMode}
        options={[{ value: "provider", label: "Business", icon: "store" }, { value: "contact", label: "Contacts", icon: "users" }, { value: "other", label: "Other", icon: "phone" }]} />

      {mode === "provider" ? (
        who ? <Chosen who={who} mode={mode} onClear={() => onWho(null)} /> : (
          <>
            <Field label="Search a business, e.g. AT&T, pizza, dentist" icon="store" value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" />
            {editNear || !near ? (
              <Field label="ZIP code or city" icon="pin" value={near} onChangeText={setNear} onBlur={() => setEditNear(false)} keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"} />
            ) : (
              <Pressable onPress={() => setEditNear(true)} accessibilityRole="button" accessibilityLabel={`Searching near ${near}. Change location`}
                style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 }}>
                <Icon name="pin" size={13} color={c.muted} /><Text style={s.meta}>Near {near} · </Text><Text style={{ color: c.primaryText, fontSize: 12, fontWeight: "600" }}>change</Text>
              </Pressable>
            )}
            {dq.length >= 2 ? (
              <View style={{ marginTop: 10 }} accessibilityLiveRegion="polite">
                {search.isFetching && !search.data ? <ActivityIndicator color={c.primary} style={{ padding: 12 }} accessibilityLabel="Searching" /> : null}
                {search.error ? <ErrorLine text={search.error instanceof Error ? search.error.message : "Search failed"} /> : null}
                {search.data && !search.data.results.length ? <Text style={[s.meta, { padding: 8 }]}>No matches with a phone number. Try another name, or use Other.</Text> : null}
                {search.data?.results.map((p) => (
                  <Pressable key={p.id} onPress={() => choose(p)} accessibilityRole="button" accessibilityLabel={`${p.name}, ${p.address}`}
                    style={({ pressed }) => [s.item, { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }, pressed && { borderColor: c.primary }]}>
                    <Avatar providerId={p.providerId ?? "custom"} size={36} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{p.name}</Text>
                      <Text style={s.meta} numberOfLines={1}>{p.address}</Text>
                      <Text style={[s.meta, { marginTop: 1 }]}>{fmtPhone(p.number)}</Text>
                    </View>
                    {p.kind === "service" ? <Pill text="Support" icon="headphones" color={c.primaryText} bg={c.primarySoft} />
                      : p.openNow === true ? <Pill text="Open" color={c.ok} bg={c.okSoft} />
                      : p.openNow === false ? <Pill text="Closed" color={c.muted} bg="#232a3f" /> : null}
                  </Pressable>
                ))}
                {search.data && !search.data.configured ? <Text style={[s.meta, { marginTop: 4 }]}>Local business search isn't switched on yet. Only national brands show for now.</Text> : null}
              </View>
            ) : null}
          </>
        )
      ) : mode === "contact" ? (
        who ? <Chosen who={who} mode={mode} onClear={() => onWho(null)} /> : (
          <>
            <Pressable onPress={openContacts} accessibilityRole="button"
              style={[s.empty, { flexDirection: "row", gap: 8, paddingVertical: 14, marginTop: 10 }]}>
              <Icon name="users" size={18} color={c.primaryText} /><Text style={{ color: c.primaryText, fontWeight: "700" }}>Pick from your contacts</Text>
            </Pressable>
            {contactErr ? <ErrorLine text={contactErr} /> : null}
          </>
        )
      ) : (
        <>
          <Field label="Name" icon="user" value={name} onChangeText={setName} />
          <Field label="Phone number" icon="phone" value={number} onChangeText={setNumber} keyboardType="phone-pad" />
        </>
      )}
    </View>
  );
}
