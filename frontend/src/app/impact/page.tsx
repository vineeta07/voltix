"use client";

import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, Clock, Gauge, Sun, Users, Zap } from "lucide-react";
import { PublicFooter, PublicNav } from "@/components/PublicShell";
import { Banner, Card, DataLabel, ErrorState, LiveBadge, Reveal, Skeleton, StatCard } from "@/components/ui";
import { api, type Impact } from "@/lib/api";

export default function ImpactPage() {
  const q = useQuery({ queryKey: ["impact"], queryFn: () => api<Impact>("/impact"), refetchInterval: 30_000 });
  const audit = useQuery({ queryKey: ["audit-verify"], queryFn: () => api<{ ok: boolean; entries: number }>("/audit/verify"), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <>
      <PublicNav />
      <main className="mx-auto max-w-[1280px] px-4 pt-10 pb-20 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3"><p className="eyebrow">Public impact</p><LiveBadge live={!!d} />{d && <DataLabel kind={d.source} />}</div>
        <h1 className="font-display mt-3 max-w-3xl text-[40px] leading-[1.08] font-medium sm:text-[56px]">What VOLTIX has done so far, in totals.</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">These numbers are computed from stored readings and refresh on their own. No names, no vehicles, no individual sessions.</p>
        {d?.source === "SIMULATED" && <div className="mt-6 max-w-2xl"><Banner tone="danger">This server is running on the built-in simulator. Every figure below is SIMULATED until real devices are paired.</Banner></div>}
        <div className="mt-10">
          {q.isLoading ? <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[124px] !rounded-xl" />)}</div>
            : q.error || !d ? <Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card> : (
              <Reveal className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                <StatCard icon={Users} label="People charging" value={d.users} hint="who have completed a session" />
                <StatCard icon={BatteryCharging} label="Sessions completed" value={d.sessions} />
                <StatCard icon={Zap} label="Energy delivered" value={d.kwh_measured} digits={1} unit="kWh" source={d.source} hint="from the plugs' own counters" />
                <StatCard icon={Clock} label="Ready-by times met" value={d.deadlines_met_pct} digits={1} unit="%" tone="safe" hint={`${d.deadlines_met} of ${d.sessions}`} />
                <StatCard icon={Sun} label="Moved into solar hours" value={d.kwh_solar} digits={1} unit="kWh" source={d.source} hint="charged while the site was exporting" />
                <StatCard icon={Gauge} label="Peak vs ToD timer" value={d.peak_reduction_pct_vs_tod} digits={0} unit="% lower" source="MODELLED" hint={d.nights_compared ? `average of ${d.nights_compared} nights; the timer case is a counterfactual` : "needs at least one night with two sessions"} />
              </Reveal>
            )}
        </div>
        <div className="mt-12 grid gap-8 border-t border-line pt-10 md:grid-cols-2">
          <div><h2 className="font-display text-[28px] font-medium">How to read this</h2><p className="mt-3 leading-relaxed text-muted">Energy and deadlines come from real sessions. The peak comparison asks what the same sessions would have done on a plain ToD timer over the same measured building load. That half is a model, and it is labelled as one.</p></div>
          <div><h2 className="font-display text-[28px] font-medium">Can it be trusted?</h2><p className="mt-3 leading-relaxed text-muted">Every plan and plug command is written to a hash-chained log. {audit.data ? <>Right now the chain is <b className={audit.data.ok ? "text-safe-ink" : "text-danger-ink"}>{audit.data.ok ? "intact" : "broken"}</b> across <span className="num">{audit.data.entries.toLocaleString("en-IN")}</span> entries.</> : "Its status is checked live."}</p></div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}
