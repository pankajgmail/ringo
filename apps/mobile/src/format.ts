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

/** "Due now" / "in 25m" / "Tomorrow 9:00 AM" for queued and scheduled calls. */
export function fmtSched(t: string) {
  const mins = Math.round((new Date(t).getTime() - Date.now()) / 6e4);
  if (mins <= 0) return { text: "Due now", due: true };
  if (mins < 60) return { text: `in ${mins}m`, due: false };
  return { text: fmtWhen(t), due: false };
}

/** m:ss or h:mm:ss for the live call timer. */
export function fmtDur(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

/** Whole days from today to a YYYY-MM-DD date (0 = today). */
export function daysUntil(date: string) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(`${date}T12:00`); b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}

export function fmtTime24(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(); d.setHours(h ?? 0, m ?? 0);
  return hm(d);
}

export function fmtResDay(date: string) {
  const d = daysUntil(date);
  return d === 0 ? "tonight" : d === 1 ? "tomorrow" : new Date(`${date}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
