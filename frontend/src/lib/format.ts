// Every time on screen is IST; every number carries its unit.
const TZ = "Asia/Kolkata";
const hm = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dm = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" });
const full = new Intl.DateTimeFormat("en-IN", {
  timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});

export const time = (iso?: string | null) => (iso ? hm.format(new Date(iso)) : "–");
export const day = (iso?: string | null) => (iso ? dm.format(new Date(iso)) : "–");
export const dateTime = (iso?: string | null) => (iso ? full.format(new Date(iso)) : "–");

export function kw(w?: number | null, digits = 1) {
  if (w == null || Number.isNaN(w)) return "–";
  return `${(w / 1000).toFixed(digits)} kW`;
}
export function watts(w?: number | null) {
  if (w == null) return "–";
  return Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}
export function kwh(wh?: number | null, digits = 1) {
  if (wh == null) return "–";
  return `${(wh / 1000).toFixed(digits)} kWh`;
}
export function rupees(paise?: number | null, digits = 0) {
  if (paise == null) return "–";
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
export function minutes(min?: number | null) {
  if (min == null) return "–";
  const m = Math.round(Math.abs(min));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
export function ago(iso?: string | null) {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const pct = (v?: number | null, digits = 0) => (v == null ? "–" : `${v.toFixed(digits)}%`);

/** Local IST wall-clock "HH:MM" on the next occurrence -> ISO UTC string. */
export function nextIst(hhmm: string, from = new Date()): string {
  const [h, m] = hhmm.split(":").map(Number);
  const istNow = new Date(from.getTime() + 330 * 60000);
  const t = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), h, m) - 330 * 60000;
  const out = t <= from.getTime() + 15 * 60000 ? t + 86400000 : t;
  return new Date(out).toISOString();
}
