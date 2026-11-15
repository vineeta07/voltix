"use client";

import { useCallback } from "react";
import type { Live, Report, StrategyKey, Sweep, TwinLevel } from "@/lib/api";
import { STRATEGY_LABEL } from "@/lib/api";
import { time } from "@/lib/format";
import { baseOption, EChart, type Palette } from "./EChart";

/** Insert a null point where readings stop for more than 20 min, so lines break instead of bridging the gap. */
function gapped<T extends { ts: string }>(rows: T[], pick: (r: T) => number): [number, number | null][] {
  const out: [number, number | null][] = [];
  rows.forEach((r, i) => {
    const t = Date.parse(r.ts);
    if (i && t - Date.parse(rows[i - 1].ts) > 20 * 60000) out.push([t - 1, null]);
    out.push([t, pick(r)]);
  });
  return out;
}
const kwFmt = (v: number) => `${(v / 1000).toFixed(1)} kW`;
const istTime = (v: number) => time(new Date(v).toISOString());
type Row = { seriesName: string; value: [number, number] | number; marker: string; axisValueLabel?: string; name?: string };

function tip(fmt: (v: number) => string, head?: (rows: Row[]) => string) {
  return (rows: Row[]) => {
    const h = head ? head(rows) : rows[0]?.axisValueLabel ?? rows[0]?.name ?? "";
    const body = rows
      .filter((r) => !r.seriesName.startsWith("_"))
      .map((r) => {
        const v = Array.isArray(r.value) ? r.value[1] : r.value;
        return v == null ? "" : `<div style="display:flex;justify-content:space-between;gap:16px"><span>${r.marker}${r.seriesName}</span><b style="font-family:IBM Plex Mono;font-weight:500">${fmt(v)}</b></div>`;
      })
      .join("");
    return `<div style="font-family:IBM Plex Mono;font-size:11px;opacity:.7;margin-bottom:4px">${h}</div>${body}`;
  };
}
const timeHead = (rows: Row[]) => (Array.isArray(rows[0]?.value) ? `${istTime(rows[0].value[0])} IST` : "");

function limitLine(p: Palette, y: number, name = "Site limit") {
  return {
    silent: true, symbol: "none", animation: false,
    lineStyle: { color: p.danger, type: "dashed" as const, width: 1.5 },
    label: { formatter: name, color: p.danger, fontSize: 11, position: "insideEndTop" as const, fontFamily: "IBM Plex Mono" },
    data: [{ yAxis: y }],
  };
}

/* ---------- LoadChart: measured load, limit, forecast band, solar export ---------- */
export function LoadChart({ live, height = 340 }: { live: Live; height?: number }) {
  const build = useCallback((p: Palette) => {
    const b = baseOption(p);
    // break the line where the meter was silent, rather than drawing across the gap
    const rows: { t: number; load_w: number | null; ev_w: number | null; export_w: number | null }[] = [];
    live.history.forEach((h, i) => {
      const t = Date.parse(h.ts);
      if (i && t - Date.parse(live.history[i - 1].ts) > 15 * 60000) rows.push({ t: t - 1, load_w: null, ev_w: null, export_w: null });
      rows.push({ t, ...h });
    });
    const hist = rows.map((h) => [h.t, h.load_w]);
    const ev = rows.map((h) => [h.t, h.ev_w]);
    const exp = rows.map((h) => [h.t, h.export_w]);
    const evPlan = live.plan?.ev_w ?? [];
    const slot0 = live.plan ? Date.parse(live.plan.slot_start) : 0;
    const fc = live.forecast.points.slice(0, 48).map((f) => {
      const t = Date.parse(f.ts);
      const i = Math.round((t - slot0) / 900000);
      const planned = i >= 0 && i < evPlan.length ? evPlan[i] : 0;
      return { t, p50: f.p50_w + planned, p90: f.p90_w + planned };
    });
    const now = Date.parse(live.now);
    return {
      ...b,
      xAxis: { type: "time", ...b.axis, splitLine: { show: false }, axisLabel: { ...b.axis.axisLabel, formatter: istTime } },
      yAxis: { type: "value", ...b.axis, axisLine: { show: false }, axisLabel: { ...b.axis.axisLabel, formatter: (v: number) => `${v / 1000}` }, name: "kW", nameTextStyle: { color: p.muted, fontSize: 11, align: "right" }, max: (v: { max: number }) => Math.ceil(Math.max(v.max, live.limit_w * 1.08) / 1000) * 1000 },
      tooltip: { ...b.tooltip, formatter: tip(kwFmt, timeHead) },
      series: [
        { name: "_p50", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, data: fc.map((f) => [f.t, f.p50]), silent: true },
        { name: "Forecast P50–P90", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: p.amber, opacity: 0.28 }, itemStyle: { color: p.amber }, data: fc.map((f) => [f.t, Math.max(0, f.p90 - f.p50)]), silent: true, tooltip: { show: false } },
        { name: "Forecast P50 + plan", type: "line", symbol: "none", lineStyle: { color: p.amber, width: 1.5, type: "dashed" }, itemStyle: { color: p.amber }, data: fc.map((f) => [f.t, f.p50]) },
        { name: "Solar export", type: "line", symbol: "none", lineStyle: { color: p.safe, width: 1.5 }, itemStyle: { color: p.safe }, areaStyle: { color: p.safe, opacity: 0.1 }, data: exp },
        { name: "EV charging", type: "line", symbol: "none", step: "end", lineStyle: { color: p.greyDark, width: 1.25 }, itemStyle: { color: p.greyDark }, data: ev },
        {
          name: "Site load", type: "line", symbol: "none", lineStyle: { color: p.teal, width: 2 }, itemStyle: { color: p.teal },
          areaStyle: { color: p.teal, opacity: 0.1 }, data: hist, z: 5,
          markLine: { ...limitLine(p, live.limit_w), data: [{ yAxis: live.limit_w }, { xAxis: now, lineStyle: { color: p.muted, type: "solid", width: 1 }, label: { formatter: "now", color: p.muted, fontSize: 11, fontFamily: "IBM Plex Mono" } }] },
        },
      ],
      legend: { ...b.legend, data: ["Site load", "EV charging", "Solar export", "Forecast P50 + plan", "Forecast P50–P90"] },
    };
  }, [live]);
  return <EChart build={build} height={height} label="Site load over time against the site limit, with the forecast band and solar export" />;
}

/* ---------- Snapback / strategies over one day on the transformer ---------- */
const STRAT_ORDER: StrategyKey[] = ["uncontrolled", "tod_timer", "random_delay", "site_limit_only", "voltix"];
function stratStyle(p: Palette, k: StrategyKey) {
  if (k === "voltix") return { color: p.teal, width: 2.5, type: "solid" as const };
  if (k === "tod_timer") return { color: p.greyDark, width: 2, type: "solid" as const };
  if (k === "uncontrolled") return { color: p.grey, width: 1.5, type: "dotted" as const };
  if (k === "random_delay") return { color: p.grey, width: 1.5, type: "dashed" as const };
  return { color: p.grey, width: 1.5, type: "solid" as const };
}
function slotLabels(level: TwinLevel, n: number) {
  const h0 = level.start_hour_ist ?? 12;
  return Array.from({ length: n }, (_, i) => {
    const m = (h0 * 60 + i * 15) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });
}

export function StrategyDayChart({ level, show, height = 340, metric = "load" }: {
  level: TwinLevel; show: StrategyKey[]; height?: number; metric?: "load" | "hotspot";
}) {
  const build = useCallback((p: Palette) => {
    const b = baseOption(p);
    const n = 112;
    const labels = slotLabels(level, n);
    const rated = level.rated_w ?? 1;
    const series: Record<string, unknown>[] = STRAT_ORDER.filter((k) => show.includes(k)).map((k) => {
      const st = stratStyle(p, k);
      const m = level.strategies[k];
      const data = metric === "load" ? (m.total_w ?? []).slice(0, n).map((w) => +(w / 1000).toFixed(2)) : (m.hot_spot_c ?? []).slice(0, n);
      return { name: STRATEGY_LABEL[k], type: "line", symbol: "none", smooth: metric === "hotspot" ? 0.2 : 0, step: metric === "load" ? "end" : undefined, lineStyle: st, itemStyle: { color: st.color }, data, z: k === "voltix" ? 5 : 2, areaStyle: k === "voltix" && metric === "load" ? { color: p.teal, opacity: 0.08 } : undefined };
    });
    if (metric === "load") {
      series.unshift({ name: "Homes + building", type: "line", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: p.line }, areaStyle: { color: p.grey, opacity: 0.16 }, data: (level.base_w ?? []).slice(0, n).map((w) => +(w / 1000).toFixed(2)), z: 1 });
    }
    (series[series.length - 1] as Record<string, unknown>).markLine =
      metric === "load" ? limitLine(p, +(rated / 1000).toFixed(1), "Transformer rating") : limitLine(p, 98, "98 °C rated hot-spot");
    return {
      ...b,
      xAxis: { type: "category", data: labels, boundaryGap: false, ...b.axis, splitLine: { show: false }, axisLabel: { ...b.axis.axisLabel, interval: 15 } },
      yAxis: { type: "value", ...b.axis, axisLine: { show: false }, scale: metric === "hotspot", name: metric === "load" ? "kW" : "°C", nameTextStyle: { color: p.muted, fontSize: 11, align: "right" }, max: metric === "load" ? (v: { max: number }) => Math.ceil(Math.max(v.max, (rated / 1000) * 1.08) / 10) * 10 : (v: { max: number }) => Math.ceil(Math.max(v.max, 104) / 10) * 10 },
      tooltip: { ...b.tooltip, formatter: tip((v) => (metric === "load" ? `${v.toFixed(1)} kW` : `${v.toFixed(1)} °C`), (r) => `${r[0]?.name ?? r[0]?.axisValueLabel} IST`) },
      series,
    };
  }, [level, show, metric]);
  return <EChart build={build} height={height} label={metric === "load" ? "Transformer load across the day for each charging strategy" : "Transformer hot-spot temperature across the day for each strategy"} />;
}

/* ---------- Adoption sweep: the headline chart ---------- */
export function SweepChart({ sweep, metric, height = 360 }: { sweep: Sweep; metric: "peak_pct" | "max_hot_spot_c" | "minutes_over" | "life_lost_paise"; height?: number }) {
  const build = useCallback((p: Palette) => {
    const b = baseOption(p);
    const unit = { peak_pct: "%", max_hot_spot_c: "°C", minutes_over: "min", life_lost_paise: "₹" }[metric];
    const series: Record<string, unknown>[] = STRAT_ORDER.map((k) => {
      const st = stratStyle(p, k);
      return {
        name: STRATEGY_LABEL[k], type: "line", symbol: "circle", symbolSize: k === "voltix" ? 7 : 5, lineStyle: st, itemStyle: { color: st.color }, z: k === "voltix" ? 5 : 2,
        data: sweep.levels.map((l) => { const v = l.strategies[k][metric]; return metric === "life_lost_paise" ? +(v / 100).toFixed(2) : v; }),
      };
    });
    if (metric === "peak_pct") (series[4] as Record<string, unknown>).markLine = limitLine(p, 100, "100% of rating");
    if (metric === "max_hot_spot_c") (series[4] as Record<string, unknown>).markLine = limitLine(p, 98, "98 °C rated hot-spot");
    return {
      ...b,
      xAxis: { type: "category", data: sweep.levels.map((l) => `${l.adoption_pct}%`), ...b.axis, splitLine: { show: false }, name: "homes with an EV", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: p.muted, fontSize: 11 } },
      grid: { ...b.grid, bottom: 24 },
      yAxis: { type: "value", ...b.axis, axisLine: { show: false }, scale: metric !== "minutes_over" && metric !== "life_lost_paise", name: unit, nameTextStyle: { color: p.muted, fontSize: 11, align: "right" } },
      tooltip: { ...b.tooltip, formatter: tip((v) => (unit === "₹" ? `₹${v.toFixed(2)}` : `${v} ${unit}`), (r) => `${r[0]?.name} of homes with an EV`) },
      series,
    };
  }, [sweep, metric]);
  return <EChart build={build} height={height} label="EV adoption sweep comparing the five charging strategies" />;
}

/* ---------- Night report: measured night vs the ToD-timer counterfactual ---------- */
export function NightChart({ report, height = 320 }: { report: Report; height?: number }) {
  const build = useCallback((p: Palette) => {
    const b = baseOption(p);
    const t0 = Date.parse(report.window.start);
    const tod = (report.tod_timer?.total_w ?? []).slice(0, 96).map((w, i) => [t0 + i * 900000, w]);
    return {
      ...b,
      xAxis: { type: "time", ...b.axis, splitLine: { show: false }, min: t0, max: Date.parse(report.window.end), axisLabel: { ...b.axis.axisLabel, formatter: istTime } },
      yAxis: { type: "value", ...b.axis, axisLine: { show: false }, axisLabel: { ...b.axis.axisLabel, formatter: (v: number) => `${v / 1000}` }, name: "kW", nameTextStyle: { color: p.muted, fontSize: 11, align: "right" } },
      tooltip: { ...b.tooltip, formatter: tip(kwFmt, timeHead) },
      series: [
        { name: "ToD timer (modelled)", type: "line", step: "end", symbol: "none", lineStyle: { color: p.greyDark, width: 1.5 }, itemStyle: { color: p.greyDark }, data: tod },
        { name: "EV charging", type: "line", step: "end", symbol: "none", lineStyle: { color: p.amber, width: 1.25 }, itemStyle: { color: p.amber }, data: gapped(report.series, (s) => s.ev_w) },
        { name: "Site load", type: "line", symbol: "none", lineStyle: { color: p.teal, width: 2 }, itemStyle: { color: p.teal }, areaStyle: { color: p.teal, opacity: 0.1 }, data: gapped(report.series, (s) => s.load_w), z: 5, markLine: limitLine(p, report.limit_w) },
      ],
    };
  }, [report]);
  return <EChart build={build} height={height} label="Site load through the night against the limit and the ToD-timer counterfactual" />;
}

/* ---------- Forecast: recent actuals then the P50/P90 band ---------- */
export function ForecastChart({ recent, points, capacity, height = 340 }: {
  recent: { ts: string; nonev_w: number; surplus_w: number }[]; points: { ts: string; p50_w: number; p90_w: number; solar_w: number }[]; capacity?: number[]; height?: number;
}) {
  const build = useCallback((p: Palette) => {
    const b = baseOption(p);
    const f = points.map((x) => ({ t: Date.parse(x.ts), ...x }));
    return {
      ...b,
      xAxis: { type: "time", ...b.axis, splitLine: { show: false }, axisLabel: { ...b.axis.axisLabel, formatter: istTime } },
      yAxis: { type: "value", ...b.axis, axisLine: { show: false }, axisLabel: { ...b.axis.axisLabel, formatter: (v: number) => `${v / 1000}` }, name: "kW", nameTextStyle: { color: p.muted, fontSize: 11, align: "right" } },
      tooltip: { ...b.tooltip, formatter: tip(kwFmt, timeHead) },
      legend: { ...b.legend, data: ["Non-EV load", "Forecast P50", "P50–P90 band", "Solar surplus", ...(capacity ? ["Room for EVs"] : [])] },
      series: [
        { name: "_base", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, data: f.map((x) => [x.t, x.p50_w]), silent: true },
        { name: "P50–P90 band", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: p.amber }, areaStyle: { color: p.amber, opacity: 0.28 }, data: f.map((x) => [x.t, Math.max(0, x.p90_w - x.p50_w)]), tooltip: { show: false } },
        { name: "Forecast P50", type: "line", symbol: "none", lineStyle: { color: p.amber, width: 2, type: "dashed" }, itemStyle: { color: p.amber }, data: f.map((x) => [x.t, x.p50_w]) },
        { name: "Solar surplus", type: "line", symbol: "none", lineStyle: { color: p.safe, width: 1.5 }, itemStyle: { color: p.safe }, areaStyle: { color: p.safe, opacity: 0.1 }, data: [...recent.map((r) => [Date.parse(r.ts), r.surplus_w]), ...f.map((x) => [x.t, x.solar_w])] },
        ...(capacity ? [{ name: "Room for EVs", type: "line", step: "end", symbol: "none", lineStyle: { color: p.grey, width: 1.25 }, itemStyle: { color: p.grey }, data: f.map((x, i) => [x.t, capacity[i]]) }] : []),
        { name: "Non-EV load", type: "line", symbol: "none", lineStyle: { color: p.teal, width: 2 }, itemStyle: { color: p.teal }, data: recent.map((r) => [Date.parse(r.ts), r.nonev_w]), z: 5 },
      ],
    };
  }, [recent, points, capacity]);
  return <EChart build={build} height={height} label="Recent non-EV load followed by the P50 to P90 forecast band" />;
}
