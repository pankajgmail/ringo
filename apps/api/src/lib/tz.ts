// Small time-zone helpers (Intl only, no library). Users' times are wall-clock times in their own zone.

/** Offset of `tz` from UTC at instant `d`, in ms (positive east of UTC). */
function offsetMs(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** "2026-11-25" + "19:00" in America/Los_Angeles → the UTC instant. Handles DST by re-checking the offset. */
export function zoned(date: string, time: string, tz: string): Date {
  const guess = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  if (Number.isNaN(guess.getTime())) throw new Error(`bad date/time ${date} ${time}`);
  let t = guess.getTime() - offsetMs(guess, tz);
  t = guess.getTime() - offsetMs(new Date(t), tz);
  return new Date(t);
}

/** Today's date in `tz` as YYYY-MM-DD, plus a readable form ("Monday, November 23, 2026"). */
export function today(tz: string, now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const long = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
  return { iso, long };
}

export const fmtTime = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
export const fmtDay = (d: Date, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);

/** Parses "YYYY-MM-DD HH:MM" (or "YYYY-MM-DD") from call analysis. A date that's already well past is assumed to mean next year. */
export function parseLocal(v: unknown, tz: string, defaultTime = "09:00"): Date | null {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const time = m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : defaultTime;
  let d = zoned(`${m[1]}-${m[2]}-${m[3]}`, time, tz);
  if (d.getTime() < Date.now() - 2 * 864e5) d = zoned(`${+m[1]! + 1}-${m[2]}-${m[3]}`, time, tz);
  return d;
}
