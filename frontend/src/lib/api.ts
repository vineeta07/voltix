"use client";

const KEY = "voltix.token";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const token = {
  get: () => (typeof window === "undefined" ? null : window.localStorage.getItem(KEY)),
  set: (t: string) => window.localStorage.setItem(KEY, t),
  clear: () => window.localStorage.removeItem(KEY),
};

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach VOLTIX. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = res.status >= 500 ? "VOLTIX is not responding. Try again in a moment." : "Request failed";
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = j.detail[0].msg;
    } catch {}
    if (res.status === 401) token.clear();
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export type Role = "user" | "operator" | "admin";
export type Me = { id: number; email: string; name: string; role: Role; consented: boolean; telegram: boolean };
export type Source = "MEASURED" | "MODELLED" | "FORECAST" | "SIMULATED" | "MIXED";

export type Plug = {
  id: number; name: string; topic: string; kind: string; max_w: number; is_on: boolean; online: boolean;
  power_w: number; total_wh: number; last_seen: string | null; source: Source; site_id: number; busy?: boolean;
};
export type Session = {
  id: number; plug_id: number; vehicle_type: string; status: "waiting" | "charging" | "paused" | "done" | "cancelled";
  power_w: number; interruptible: boolean; battery_pct: number; energy_needed_wh: number; delivered_wh: number;
  solar_wh: number; cost_paise: number; plugged_at: string; ready_by: string; planned_start: string | null;
  planned_end: string | null; started_at: string | null; ended_at: string | null; overridden: boolean;
  at_risk: boolean; proposed_ready_by: string | null; rating: number | null; anomaly: string | null;
  source: Source; user?: string; plug_name?: string; plug?: Plug | null; site_id?: number;
};
export type Alert = { id: number; ts: string; level: "info" | "warning" | "critical"; kind: string; message: string; session_id: number | null; resolved: boolean };
export type Site = {
  id: number; slug: string; name: string; kind: string; limit_va: number; safety_margin_va: number; power_factor: number;
  latitude: number; longitude: number;
  tariff: { name?: string; base_paise_per_kwh: number; windows: { label: string; start: string; end: string; multiplier: number }[] };
  transformer: Record<string, unknown>;
};
export type Live = {
  site: Site; now: string; limit_w: number; history_source: Source;
  measured: { ts: string; load_w: number; export_w: number; ev_w: number; nonev_w: number; surplus_w: number; source: Source } | null;
  history: { ts: string; load_w: number; export_w: number; ev_w: number }[];
  forecast: { method: string; points: { ts: string; p50_w: number; p90_w: number; solar_w: number }[] };
  plan: { id: number; created_at: string; slot_start: string; feasible: boolean; reason: string; capacity_w: number[]; ev_w: number[]; solver: string } | null;
  plugs: Plug[]; sessions: Session[]; alerts: Alert[]; tariff_now: { label: string; paise_per_kwh: number };
};
export type Config = { dev_login: boolean; google_client_id: string; simulate: boolean; assistant: boolean; telegram: boolean; mqtt: boolean; slot_minutes: number };
export type Impact = {
  users: number; sessions: number; kwh_measured: number; deadlines_met: number; deadlines_met_pct: number | null;
  kwh_solar: number; peak_reduction_pct_vs_tod: number | null; nights_compared: number; source: Source; registered_users: number;
};
export type StrategyKey = "voltix" | "site_limit_only" | "random_delay" | "tod_timer" | "uncontrolled";
export type StrategyMetrics = {
  peak_pct: number; minutes_over: number; max_hot_spot_c: number; life_lost_h: number; life_lost_paise: number;
  deadlines_met: number; deadlines_total: number; cost_paise: number; total_w?: number[]; ev_w?: number[]; hot_spot_c?: number[]; top_oil_c?: number[];
};
export type TwinLevel = {
  adoption_pct: number; evs: number; strategies: Record<StrategyKey, StrategyMetrics>; base_w?: number[]; household_w?: number[];
  building_w?: number[]; ambient_c?: number[]; rated_w?: number; household_source?: string; building_source?: string; start_hour_ist?: number; slot_min?: number;
};
export type Sweep = {
  config: { rated_kva: number; homes: number; adoption_levels: number[]; mix: Record<string, number>; transformer_cost_paise: number; normal_life_h: number };
  levels: TwinLevel[]; first_overload: Record<StrategyKey, { first_overload_pct: number | null; first_failure_pct: number | null }>;
  household_source: string; building_source: string;
};
export type Report = {
  site: string; night_of: string; window: { start: string; end: string }; source: Source; has_data: boolean; peak_w: number; peak_15min_w: number;
  limit_w: number; limit_va: number; peak_pct_of_limit: number | null; sessions: number; sessions_done: number; ready_by_met: number;
  worst_spare_min: number | null; kwh_delivered: number; kwh_solar: number; cost_paise: number;
  tod_timer: { peak_w: number; cost_paise: number; total_w: number[] } | null; uncontrolled: { peak_w: number; cost_paise: number } | null;
  saved_paise_vs_uncontrolled: number | null; peak_reduction_pct_vs_tod: number | null; overrides: number;
  audit: { ok: boolean; entries: number; broken_at: number | null; head: string };
  series: { ts: string; load_w: number; ev_w: number; export_w: number }[]; session_rows: Session[];
};
export type Vehicles = Record<string, { label: string; label_hi: string; wheels: number; battery_wh: number; charger_w: number; interruptible: boolean }>;

export const STRATEGY_LABEL: Record<StrategyKey, string> = {
  voltix: "VOLTIX",
  site_limit_only: "Site limit only",
  random_delay: "Random delay",
  tod_timer: "ToD timer",
  uncontrolled: "Uncontrolled",
};
