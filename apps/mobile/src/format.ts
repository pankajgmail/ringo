export const hm = (d: Date | string) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function fmtWhen(t: string) {
  const d = new Date(t), today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return `Today ${hm(d)}`;
  if (diff === -1) return `Yesterday ${hm(d)}`;
  if (diff === 1) return `Tomorrow ${hm(d)}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm(d)}`;
}

export function fmtShort(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.round(sec / 60);
  return sec < 60 ? `${sec}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtPhone(n: string) {
  const d = n.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n;
}

/** Accepts "(415) 555-0130", "415-555-0130", "+14155550130" → E.164 (US default). */
export function toE164(input: string) {
  const d = input.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return input.startsWith("+") ? `+${d}` : input;
}
