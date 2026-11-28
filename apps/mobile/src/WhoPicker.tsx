import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useApi, type PlaceHit } from "./api.ts";
import { loadContacts, shareMoreContacts, type PhoneContact } from "./contacts.ts";
import { Avatar, ErrorLine, Field, Icon, Initials, Meta, MetaText, Pill, Seg, s } from "./ui.tsx";
import { fmtPhone } from "./format.ts";
import { c } from "./theme.ts";

export type WhoMode = "provider" | "contact" | "other";
/** What the form sends: a known brand id, or a name + number. */
export type Who = { providerId: string; name: string; number: string; address?: string } | null;
/** Most contacts one "New call" can fan out to (POST /v1/calls allows 20 an hour). */
export const MAX_CONTACTS = 10;

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

export function WhoPicker({ mode, onMode, who, onWho, picked, onPicked, defaultNear }: {
  mode: WhoMode; onMode: (m: WhoMode) => void; who: Who; onWho: (w: Who) => void;
  /** Contacts mode: everyone selected. Each gets their own call. */
  picked: PhoneContact[]; onPicked: (p: PhoneContact[]) => void; defaultNear: string;
}) {
  const api = useApi();
  const [q, setQ] = useState("");
  const [near, setNear] = useState(defaultNear);
  const [editNear, setEditNear] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  useEffect(() => { if (!near && defaultNear) setNear(defaultNear); }, [defaultNear]); // eslint-disable-line react-hooks/exhaustive-deps

  const dq = useDebounced(q.trim());
  const dnear = useDebounced(near.trim());
  const search = useQuery({ queryKey: ["places", dq, dnear], queryFn: () => api.places(dq, dnear || undefined), enabled: mode === "provider" && !who && dq.length >= 2, staleTime: 5 * 60_000 });

  // "Other": the typed name + number is the selection.
  useEffect(() => {
    if (mode === "other") onWho(name.trim() || number.trim() ? { providerId: "custom", name: name.trim(), number } : null);
  }, [mode, name, number]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m: WhoMode) => { onMode(m); onWho(null); onPicked([]); };
  const choose = (p: PlaceHit) => onWho({ providerId: p.providerId ?? "custom", name: p.providerId ? p.name.replace(/ customer service$/, "") : p.name, number: p.number, address: p.kind === "place" ? p.address : undefined });

  return (
    <View>
      <Seg<WhoMode> label="Who should RingVo call" value={mode} onChange={switchMode}
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
        <ContactList picked={picked} onPicked={onPicked} />
      ) : (
        <>
          <Field label="Name" icon="user" value={name} onChangeText={setName} />
          <Field label="Phone number" icon="phone" value={number} onChangeText={setNumber} keyboardType="phone-pad" />
        </>
      )}
    </View>
  );
}

type Book = { state: "idle" | "loading" } | { state: "ok"; all: PhoneContact[]; limited: boolean } | { state: "denied"; canAsk: boolean } | { state: "unsupported" } | { state: "error"; msg: string };

/** Every phone contact, searchable, with checkboxes. Read on the device; only the chosen numbers are sent to RingVo. */
function ContactList({ picked, onPicked }: { picked: PhoneContact[]; onPicked: (p: PhoneContact[]) => void }) {
  const [book, setBook] = useState<Book>({ state: "idle" });
  const [q, setQ] = useState("");
  const [capMsg, setCapMsg] = useState(false);

  const load = async () => {
    setBook({ state: "loading" });
    try {
      const r = await loadContacts();
      if (r.status === "ok") {
        setBook({ state: "ok", all: r.contacts, limited: r.limited });
        if (Platform.OS === "web") onPicked(r.contacts.slice(0, MAX_CONTACTS)); // browser picker: what they picked is the selection
      } else setBook(r.status === "denied" ? { state: "denied", canAsk: r.canAsk } : { state: "unsupported" });
    } catch (e) { setBook({ state: "error", msg: e instanceof Error ? e.message : String(e) }); }
  };
  useEffect(() => { if (Platform.OS !== "web") void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    try { const all = await shareMoreContacts(); setBook({ state: "ok", all, limited: true }); } catch { /* user closed the sheet */ }
  };

  const sel = new Set(picked.map((p) => p.key));
  const toggle = (p: PhoneContact) => {
    if (sel.has(p.key)) { setCapMsg(false); return onPicked(picked.filter((x) => x.key !== p.key)); }
    if (picked.length >= MAX_CONTACTS) return setCapMsg(true);
    onPicked([...picked, p]);
  };

  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const all = book.state === "ok" ? book.all : [];
  const hits = needle ? all.filter((p) => p.name.toLowerCase().includes(needle) || (digits.length >= 3 && p.number.replace(/\D/g, "").includes(digits))) : all;
  const shown = hits.slice(0, 200);

  return (
    <View>
      {picked.length ? (
        <View style={[s.row, { marginTop: 10 }]} accessibilityLabel={`${picked.length} selected`}>
          {picked.map((p) => (
            <Pressable key={p.key} onPress={() => toggle(p)} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`} hitSlop={4}
              style={[s.fchip, { borderColor: c.primary, backgroundColor: c.primarySoft }]}>
              <Text style={{ color: c.text, fontSize: 12, fontWeight: "600" }} numberOfLines={1}>{p.name}</Text>
              <Icon name="x" size={12} color={c.primaryText} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={[s.meta, { marginTop: 8 }]} accessibilityLiveRegion="polite">
        {picked.length ? `${picked.length} selected · RingVo makes a separate call to each` : `Select up to ${MAX_CONTACTS} people. RingVo calls each one with the same task.`}
      </Text>
      {capMsg ? <ErrorLine text={`You can pick up to ${MAX_CONTACTS} people per request.`} /> : null}

      {book.state === "idle" || book.state === "unsupported" || book.state === "error" ? (
        <>
          <Pressable onPress={load} accessibilityRole="button" style={[s.empty, { flexDirection: "row", gap: 8, paddingVertical: 14, marginTop: 10 }]}>
            <Icon name="users" size={18} color={c.primaryText} />
            <Text style={{ color: c.primaryText, fontWeight: "700" }}>{Platform.OS === "web" ? "Pick from your contacts" : "Show my contacts"}</Text>
          </Pressable>
          {book.state === "unsupported" ? <ErrorLine text="This browser can't open your contacts. Use the RingVo app on your phone, or choose Other and type the number." /> : null}
          {book.state === "error" ? <ErrorLine text={`Couldn't read your contacts. Try again. (${book.msg.slice(0, 160)})`} /> : null}
        </>
      ) : book.state === "loading" ? (
        <ActivityIndicator color={c.primary} style={{ padding: 16 }} accessibilityLabel="Loading contacts" />
      ) : book.state === "denied" ? (
        <View style={[s.item, { marginTop: 10, gap: 8 }]}>
          <Text style={{ color: c.text, fontWeight: "700" }}>RingVo can't see your contacts</Text>
          <Text style={s.meta}>Allow Contacts access so you can pick who to call. Your contact list stays on your phone.</Text>
          <Pressable onPress={book.canAsk ? load : () => void Linking.openSettings()} accessibilityRole="button" hitSlop={6}>
            <Text style={{ color: c.primaryText, fontWeight: "700" }}>{book.canAsk ? "Allow access" : "Open Settings"}</Text>
          </Pressable>
        </View>
      ) : Platform.OS === "web" ? null : (
        <>
          <Field label="Search contacts" icon="user" value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
          {book.state === "ok" && book.limited ? (
            <Pressable onPress={more} accessibilityRole="button" style={{ flexDirection: "row", gap: 5, alignItems: "center", marginTop: 8 }}>
              <Icon name="plus" size={13} color={c.primaryText} />
              <Text style={{ color: c.primaryText, fontSize: 12, fontWeight: "600" }}>You shared only some contacts. Add more</Text>
            </Pressable>
          ) : null}
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 360, marginTop: 8 }}>
            {!all.length ? <Text style={[s.meta, { padding: 8 }]}>No contacts with a phone number.</Text>
              : !hits.length ? <Text style={[s.meta, { padding: 8 }]}>No contacts match “{q.trim()}”.</Text> : null}
            {shown.map((p) => {
              const on = sel.has(p.key);
              return (
                <Pressable key={p.key} onPress={() => toggle(p)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                  accessibilityLabel={`${p.name}, ${p.label ? `${p.label} ` : ""}${fmtPhone(p.number)}`}
                  style={({ pressed }) => [s.item, { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6, paddingVertical: 8 },
                    on && { borderColor: c.primary, backgroundColor: "#1b1f3b" }, pressed && { opacity: 0.8 }]}>
                  <Initials name={p.name} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: c.text, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.meta} numberOfLines={1}>{p.label ? `${p.label} · ` : ""}{fmtPhone(p.number)}</Text>
                  </View>
                  <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: on ? c.primary : c.muted, backgroundColor: on ? c.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {on ? <Icon name="check" size={14} color="#fff" strokeWidth={3} /> : null}
                  </View>
                </Pressable>
              );
            })}
            {hits.length > shown.length ? <Text style={[s.meta, { padding: 8, textAlign: "center" }]}>Showing {shown.length} of {hits.length}. Search to find more.</Text> : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}
