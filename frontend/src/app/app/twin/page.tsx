"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useState } from "react";
import { StrategyDayChart, SweepChart } from "@/components/charts";
import { Banner, Card, CardHead, DataLabel, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { api, STRATEGY_LABEL, type StrategyKey, type Sweep, type TwinLevel } from "@/lib/api";
import { rupees } from "@/lib/format";
import { useSite } from "@/lib/site";

const ORDER: StrategyKey[] = ["voltix", "site_limit_only", "random_delay", "tod_timer", "uncontrolled"];
const ABOUT: Record<StrategyKey, string> = {
  voltix: "Each vehicle gets its own start time",
  site_limit_only: "First come, first served under the limit",
  random_delay: "ToD timer plus a random delay of up to 30 min",
  tod_timer: "Everyone starts when the cheap rate begins",
  uncontrolled: "Everyone starts when they plug in",
};
const METRICS = [["peak_pct", "Peak load"], ["max_hot_spot_c", "Hot-spot"], ["minutes_over", "Minutes over"], ["life_lost_paise", "Life lost"]] as const;

export default function TwinPage() {
  const { site } = useSite();
  const [metric, setMetric] = useState<(typeof METRICS)[number][0]>("peak_pct");
  const [adoption, setAdoption] = useState(30);
  const [view, setView] = useState<"load" | "hotspot">("load");
  const [show, setShow] = useState<StrategyKey[]>(["voltix", "tod_timer", "uncontrolled"]);
  const sweep = useQuery({ queryKey: ["twin", site?.id], queryFn: () => api<Sweep>(`/sites/${site!.id}/twin`), enabled: !!site, staleTime: Infinity });
  const level = useQuery({ queryKey: ["twin-level", site?.id, adoption], queryFn: () => api<TwinLevel>(`/sites/${site!.id}/twin/level?adoption=${adoption}`), enabled: !!site, staleTime: Infinity, placeholderData: (p) => p });
  const s = sweep.data;
  const max = s ? Math.max(...s.config.adoption_levels) : 40;

  return (
    <>
      <PageHeader title="Neighbourhood twin" lead="The same scheduling logic, scaled to a whole distribution transformer: your building plus modelled homes and EVs." right={<DataLabel kind="MODELLED" />} />
      {sweep.error ? <Card><ErrorState error={sweep.error} retry={() => sweep.refetch()} /></Card> : !s ? (
        <Card className="p-6" aria-busy="true"><p className="text-sm text-muted">Running five strategies across eight adoption levels through the scheduler and the thermal model. This takes about half a minute the first time.</p><Skeleton className="mt-4 h-[360px]" /></Card>
      ) : (
        <>
          {s.household_source.includes("placeholder") && <div className="mb-4"><Banner tone="amber">Household profiles are a synthetic placeholder until the CEEW smart-meter files are prepared with <span className="num">tools/ceew_prepare.py</span>. Treat absolute numbers as indicative.</Banner></div>}

          <Card className="p-4 sm:p-6">
            <p className="eyebrow">Headline · adoption at which each strategy first overloads</p>
            <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-5">
              {ORDER.map((k) => {
                const v = s.first_overload[k].first_overload_pct;
                return (
                  <div key={k} className={clsx("border-l-2 pl-3", k === "voltix" ? "border-teal" : "border-line-strong")}>
                    <div className="text-sm font-medium">{STRATEGY_LABEL[k]}</div>
                    <div className={clsx("num mt-1 text-[32px] leading-none font-medium", v == null ? "text-safe-ink" : "text-danger-ink")}>{v == null ? `>${max}%` : `${v}%`}</div>
                    <div className="mt-1.5 text-xs text-muted">{v == null ? `No overload up to ${max}% of homes` : "of homes with an EV"}</div>
                    <div className="mt-1 text-xs text-muted">{ABOUT[k]}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="mt-4">
            <CardHead title="EV-adoption sweep" hint={`${s.config.rated_kva} kVA transformer · ${s.config.homes} homes · building load ${s.building_source === "none" ? "not included" : s.building_source.toLowerCase()}`}
              right={<div className="flex flex-wrap rounded-lg border border-line-strong p-0.5" role="group" aria-label="Metric">
                {METRICS.map(([k, l]) => <button key={k} onClick={() => setMetric(k)} aria-pressed={metric === k} className={clsx("h-7 rounded-md px-2.5 text-xs transition-colors", metric === k ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{l}</button>)}
              </div>} />
            <div className="px-2 pt-3 pb-3 sm:px-4"><SweepChart sweep={s} metric={metric} /></div>
          </Card>

          <Card className="mt-4">
            <CardHead title={`One day on the transformer at ${adoption}% adoption`} hint={level.data ? `${level.data.evs} EVs · noon to 4 pm next day (IST)` : undefined}
              right={<div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="View">
                {(["load", "hotspot"] as const).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={clsx("h-7 rounded-md px-2.5 text-xs transition-colors", view === v ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{v === "load" ? "Loading" : "Hot-spot °C"}</button>)}
              </div>} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-4 sm:px-6">
              <label className="flex min-w-[220px] flex-1 items-center gap-3 text-sm"><span className="shrink-0 text-muted">Adoption</span>
                <input type="range" min={5} max={max} step={5} value={adoption} onChange={(e) => setAdoption(+e.target.value)} className="h-11 w-full accent-[#1F9E89]" aria-label="EV adoption percent" /><span className="num w-10 text-right">{adoption}%</span></label>
              <div className="flex flex-wrap gap-1.5">
                {ORDER.map((k) => {
                  const on = show.includes(k);
                  return <button key={k} aria-pressed={on} onClick={() => setShow((c) => (on ? c.filter((x) => x !== k) : [...c, k]))} className={clsx("h-8 rounded-full border px-3 text-xs transition-colors", on ? (k === "voltix" ? "border-teal bg-teal-wash text-teal-ink" : "border-ink text-ink") : "border-line-strong text-muted")}>{STRATEGY_LABEL[k]}</button>;
                })}
              </div>
            </div>
            <div className="px-2 pt-2 pb-3 sm:px-4">{level.data ? <StrategyDayChart level={level.data} show={show} metric={view} /> : <Skeleton className="m-4 h-[320px]" />}</div>
          </Card>

          {level.data && (
            <Card className="mt-4">
              <CardHead title={`All five strategies at ${adoption}%`} hint="IEC 60076-7 thermal model, ONAN distribution transformer" right={<DataLabel kind="MODELLED" />} />
              <div className="mt-2 overflow-x-auto"><table className="data min-w-[720px]">
                <thead><tr><th>Strategy</th><th className="!text-right">Peak</th><th className="!text-right">Minutes over</th><th className="!text-right">Max hot-spot</th><th className="!text-right">Life used</th><th className="!text-right">₹ of life</th><th className="!text-right">Deadlines met</th></tr></thead>
                <tbody>{ORDER.map((k) => { const m = level.data!.strategies[k]; return (
                  <tr key={k} className={k === "voltix" ? "font-medium" : ""}>
                    <td><span className={clsx("mr-2 inline-block h-2 w-2 rounded-full", k === "voltix" ? "bg-teal" : "bg-grey")} />{STRATEGY_LABEL[k]}</td>
                    <td className={clsx("num text-right", m.peak_pct > 100 && "text-danger-ink")}>{m.peak_pct.toFixed(0)}%</td>
                    <td className={clsx("num text-right", m.minutes_over > 0 && "text-danger-ink")}>{m.minutes_over} min</td>
                    <td className={clsx("num text-right", m.max_hot_spot_c > 98 && "text-danger-ink")}>{m.max_hot_spot_c.toFixed(1)} °C</td>
                    <td className="num text-right">{m.life_lost_h.toFixed(1)} h</td><td className="num text-right">{rupees(m.life_lost_paise, 2)}</td>
                    <td className={clsx("num text-right", m.deadlines_met < m.deadlines_total && "text-danger-ink")}>{m.deadlines_met}/{m.deadlines_total}</td>
                  </tr>); })}</tbody></table></div>
              <p className="px-4 pt-1 pb-4 text-xs text-muted sm:px-6">Life used is equivalent ageing hours over the 32-hour window; a transformer at exactly its rating uses 32 h. ₹ of life uses the transformer cost ({rupees(s.config.transformer_cost_paise)}) and normal insulation life ({s.config.normal_life_h.toLocaleString("en-IN")} h) from the site config.</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}
