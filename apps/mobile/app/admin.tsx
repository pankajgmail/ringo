import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useApi, type AdminStats } from "@/api.ts";
import { Card, Empty, ErrorBox, Icon, Loading, PageHeader, Pill, Stat, Stats, s } from "@/ui.tsx";
import { c } from "@/theme.ts";

// Series colors, checked for color-blind separation and contrast on the dark card (#151a2b).
const OUT = "#7c6cf6";
const IN = "#d97706";

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Out vs in as one 100% bar. Each part is labelled with its name, share and count, so color isn't the only cue. */
function DirectionBar({ d }: { d: AdminStats["direction"] }) {
  const total = d.out + d.in;
  if (!total) return <Empty text="No calls yet" icon="phone" />;
  // Inbound share is the remainder, so the two always add up to 100%.
  const outPct = pct(d.out, total);
  const parts = [{ key: "Outbound", n: d.out, share: outPct, color: OUT, icon: "out" as const }, { key: "Inbound", n: d.in, share: 100 - outPct, color: IN, icon: "in" as const }];
  return (
    <View>
      <View style={{ flexDirection: "row", height: 14, gap: 2, marginTop: 4 }} accessibilityRole="image"
        accessibilityLabel={parts.map((p) => `${p.key} ${p.share} percent, ${p.n} calls`).join("; ")}>
        {parts.filter((p) => p.n).map((p) => <View key={p.key} style={{ flex: p.n, backgroundColor: p.color, borderRadius: 4 }} />)}
      </View>
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        {parts.map((p) => (
          <View key={p.key} style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color }} />
              <Icon name={p.icon} size={14} color={c.muted} />
              <Text style={s.meta}>{p.key}</Text>
            </View>
            <Text style={{ color: c.text, fontSize: 22, fontWeight: "800" }}>{p.share}%</Text>
            <Text style={s.meta}>{p.n} {p.n === 1 ? "call" : "calls"}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Where outbound calls stand. One hue for every bar: they're amounts on a shared scale, not different series. */
function OutcomeBars({ o }: { o: AdminStats["outcomes"] }) {
  const rows = [
    { label: "Completed", n: o.completed, icon: "check-circle" as const },
    { label: "Scheduled", n: o.upcoming, icon: "cal" as const },
    { label: "In progress", n: o.live, icon: "phone" as const },
    { label: "Failed", n: o.failed, icon: "x-circle" as const },
    { label: "Cancelled", n: o.cancelled, icon: "ban" as const },
  ];
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!total) return <Empty text="No outbound calls yet" icon="out" />;
  const max = Math.max(...rows.map((r) => r.n));
  return (
    <View style={{ gap: 10, marginTop: 4 }}>
      {rows.map((r) => (
        <View key={r.label} accessible accessibilityLabel={`${r.label}: ${r.n} calls, ${pct(r.n, total)} percent`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Icon name={r.icon} size={14} color={c.muted} />
            <Text style={{ color: c.text, fontSize: 13, flex: 1 }}>{r.label}</Text>
            <Text style={{ color: c.text, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{r.n}</Text>
            <Text style={[s.meta, { width: 40, textAlign: "right", fontVariant: ["tabular-nums"] }]}>{pct(r.n, total)}%</Text>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.field }}>
            {r.n ? <View style={{ width: `${(r.n / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: OUT }} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function UserRow({ u }: { u: AdminStats["users"][number] }) {
  return (
    <View style={[s.item, { gap: 4, marginBottom: 6 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: c.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>{u.name || "No name yet"}</Text>
        {u.phoneVerified ? <Pill text="Verified" icon="check-circle" color={c.ok} bg={c.okSoft} /> : <Pill text="Not verified" icon="alert" color={c.warn} bg={c.warnSoft} />}
      </View>
      <Text selectable style={s.meta} numberOfLines={1}>{u.email}</Text>
      <Text style={s.meta}>Joined {fmtDate(u.joinedAt)} · {u.outCalls} out · {u.inCalls} in</Text>
    </View>
  );
}

/** Star counts as one-hue bars (amounts on a shared scale), then the newest comments. */
function FeedbackCard({ f }: { f: AdminStats["feedback"] }) {
  const max = Math.max(1, ...f.stars);
  return (
    <Card>
      <Text style={s.h}>Feedback</Text>
      <Text style={s.meta}>{f.total ? `${f.average?.toFixed(1)} out of 5 from ${f.total} ${f.total === 1 ? "rating" : "ratings"}` : "No feedback yet"}</Text>
      {f.total ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          {[5, 4, 3, 2, 1].map((r) => {
            const n = f.stars[r - 1] ?? 0;
            return (
              <View key={r} style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessible accessibilityLabel={`${r} stars: ${n}`}>
                <Text style={[s.meta, { width: 14, textAlign: "right" }]}>{r}</Text>
                <Icon name="star" size={12} color={c.muted} />
                <View style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: c.field }}>
                  {n ? <View style={{ width: `${(n / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: OUT }} /> : null}
                </View>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: "700", width: 28, textAlign: "right", fontVariant: ["tabular-nums"] }}>{n}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {f.recent.filter((x) => x.comment).slice(0, 20).map((x) => (
        <View key={x.id} style={[s.item, { gap: 4, marginBottom: 0 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ color: c.amber, fontWeight: "800" }} accessibilityLabel={`${x.rating} stars`}>{"★".repeat(x.rating)}<Text style={{ color: c.border2 }}>{"★".repeat(5 - x.rating)}</Text></Text>
            <Text style={[s.meta, { flex: 1, textAlign: "right" }]} numberOfLines={1}>{x.name || x.email} · {fmtDate(x.at)}{x.platform ? ` · ${x.platform}` : ""}</Text>
          </View>
          <Text selectable style={{ color: c.text, fontSize: 13, lineHeight: 18 }}>{x.comment}</Text>
        </View>
      ))}
    </Card>
  );
}

export default function Admin() {
  const api = useApi();
  const q = useQuery({ queryKey: ["admin-stats"], queryFn: api.adminStats });
  const d = q.data;
  return (
    <View style={s.screen}>
      <PageHeader title="Dashboard" sub="Sign-ups and calls across all users" />
      {q.isLoading ? <Loading /> : q.error ? <View style={s.scroll}><ErrorBox error={q.error} onRetry={q.refetch} /></View> : d ? (
        <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => { q.refetch(); }} tintColor={c.primary} />}>
          <Stats>
            <Stat icon="users" value={d.signups.total} label="Signed up" />
            <Stat icon="sparkles" value={d.signups.last7d} label="Last 7 days" />
            <Stat icon="shield" value={d.signups.verified} label="Phone verified" color={c.ok} />
          </Stats>

          <Card>
            <Text style={s.h}>Outbound vs inbound</Text>
            <Text style={s.meta}>{d.direction.out + d.direction.in} calls in total</Text>
            <DirectionBar d={d.direction} />
          </Card>

          <Card>
            <Text style={s.h}>Outbound calls: completed vs scheduled</Text>
            <Text style={s.meta}>Where every call Ringo placed or will place stands now</Text>
            <OutcomeBars o={d.outcomes} />
          </Card>

          <FeedbackCard f={d.feedback} />

          <Card>
            <Text style={s.h}>Who signed up</Text>
            <Text style={s.meta}>{d.users.length < d.signups.total ? `Newest ${d.users.length} of ${d.signups.total}` : "Newest first"}</Text>
            <View style={{ marginTop: 6 }}>
              {d.users.length ? d.users.map((u) => <UserRow key={u.id} u={u} />) : <Empty text="No users yet" icon="users" />}
            </View>
          </Card>
        </ScrollView>
      ) : null}
    </View>
  );
}
