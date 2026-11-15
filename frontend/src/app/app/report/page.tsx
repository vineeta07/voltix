"use client";

import { useQuery } from "@tanstack/react-query";
import { BatteryCharging, ChevronLeft, ChevronRight, Clock, Gauge, Hand, IndianRupee, Moon, Printer, ShieldAlert, ShieldCheck, Sun } from "lucide-react";
import { useState } from "react";
import { NightChart } from "@/components/charts";
import { Button, Card, CardHead, DataLabel, EmptyState, ErrorState, PageHeader, PageSkeleton, Pill, StatCard } from "@/components/ui";
import { api, type Report } from "@/lib/api";
import { useConfig } from "@/lib/auth";
import { kw, kwh, minutes, rupees, time } from "@/lib/format";
import { useSite } from "@/lib/site";

const shift = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
const pretty = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function ReportPage() {
  const { site } = useSite();
  const cfg = useConfig();
  const [night, setNight] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["report", site?.id, night], queryFn: () => api<Report>(`/sites/${site!.id}/report${night ? `?night=${night}` : ""}`), enabled: !!site, placeholderData: (p) => p });
  const summary = useQuery({
    queryKey: ["summary", site?.id, q.data?.night_of], enabled: !!site && !!q.data?.has_data && !!cfg.data?.assistant, staleTime: Infinity, retry: false,
    queryFn: () => api<{ summary: string }>(`/assistant/night-summary?site_id=${site!.id}&night=${q.data!.night_of}`, { method: "POST" }),
  });

  if (q.isLoading || !site) return (<><PageHeader title="Night report" /><PageSkeleton /></>);
  if (q.error || !q.data) return (<><PageHeader title="Night report" /><Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card></>);
  const r = q.data;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Night report" lead={`${r.site} · noon ${pretty(r.night_of)} to noon the next day (IST)`}
        right={<>
          <div className="flex items-center rounded-lg border border-line-strong">
            <button aria-label="Previous night" onClick={() => setNight(shift(r.night_of, -1))} className="flex h-10 w-10 items-center justify-center text-muted hover:text-ink"><ChevronLeft size={18} /></button>
            <input type="date" aria-label="Night of" value={r.night_of} max={today} onChange={(e) => e.target.value && setNight(e.target.value)} className="num h-10 bg-transparent text-sm" />
            <button aria-label="Next night" disabled={r.night_of >= today} onClick={() => setNight(shift(r.night_of, 1))} className="flex h-10 w-10 items-center justify-center text-muted hover:text-ink disabled:opacity-30"><ChevronRight size={18} /></button>
          </div>
          <Button variant="secondary" size="sm" className="!h-10" onClick={() => window.print()}><Printer size={15} />Print for DISCOM</Button>
        </>} />

      {!r.has_data ? (
        <Card><EmptyState icon={Moon} title="No measurements for this night" body="The report is built only from stored meter and plug readings. Pick another night, or check that the meter was publishing." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard icon={Gauge} label="Peak vs limit" value={r.peak_pct_of_limit} digits={0} unit="%" source={r.source} tone={(r.peak_pct_of_limit ?? 0) > 100 ? "danger" : "safe"} hint={`${kw(r.peak_15min_w)} peak (15-min) · limit ${kw(r.limit_w)}`} />
            <StatCard icon={Clock} label="Ready-by times met" text={`${r.ready_by_met}/${r.sessions_done}`} value={r.ready_by_met} source={r.source} tone={r.ready_by_met === r.sessions_done ? "safe" : "danger"} hint={r.worst_spare_min != null ? `Tightest finish: ${minutes(r.worst_spare_min)} ${r.worst_spare_min >= 0 ? "to spare" : "late"}` : "No finished sessions"} />
            <StatCard icon={Sun} label="Moved into solar hours" value={r.kwh_solar} digits={1} unit="kWh" source={r.source} hint={`of ${r.kwh_delivered.toFixed(1)} kWh delivered`} />
            <StatCard icon={IndianRupee} label="Saved under ToD" text={r.saved_paise_vs_uncontrolled != null ? rupees(r.saved_paise_vs_uncontrolled) : undefined} value={r.saved_paise_vs_uncontrolled} source="MODELLED" hint={`vs charging on plug-in · paid ${rupees(r.cost_paise)}`} />
          </div>

          {cfg.data?.assistant && (
            <Card className="mt-4 p-4 sm:p-6">
              <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Plain-language summary</h2><span className="eyebrow">Written by the read-only assistant</span></div>
              {summary.isLoading ? <div className="mt-3 space-y-2"><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-4 w-2/3" /></div>
                : summary.data ? <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">{summary.data.summary}</p>
                : <p className="mt-3 text-sm text-muted">The summary is not available right now. The numbers on this page are unaffected.</p>}
            </Card>
          )}

          <Card className="mt-4">
            <CardHead title="The night, as measured" hint={r.peak_reduction_pct_vs_tod != null ? `Peak ${r.peak_reduction_pct_vs_tod.toFixed(0)}% lower than the same sessions on a ToD timer` : undefined} right={<><DataLabel kind={r.source} /><DataLabel kind="MODELLED" /></>} />
            <div className="px-2 pt-3 pb-3 sm:px-4"><NightChart report={r} /></div>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="p-4 sm:p-6">
              <h2 className="text-base font-semibold">Against the baselines</h2>
              <dl className="mt-3 text-sm">
                {[["VOLTIX (measured)", kw(r.peak_15min_w), rupees(r.cost_paise)], ["ToD timer", kw(r.tod_timer?.peak_w), rupees(r.tod_timer?.cost_paise)], ["Uncontrolled", kw(r.uncontrolled?.peak_w), rupees(r.uncontrolled?.cost_paise)]].map(([a, b, c], i) => (
                  <div key={a} className="flex items-center justify-between border-b border-line py-2.5 last:border-0"><dt className={i === 0 ? "font-medium" : "text-muted"}>{a}</dt><dd className="num text-right">{b}<span className="ml-3 text-muted">{c}</span></dd></div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted">Baselines re-place the same real sessions on the same measured building load. They are modelled, not measured.</p>
            </Card>
            <Card className="p-4 sm:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Hand size={17} strokeWidth={1.75} />Overrides</h2>
              <div className="num mt-3 text-[32px] leading-none font-medium">{r.overrides}</div>
              <p className="mt-2 text-sm text-muted">{r.overrides === 0 ? "Nobody needed to take over from the schedule." : "Times a user chose to charge now or stop. Each one is in the audit log."}</p>
            </Card>
            <Card className="p-4 sm:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">{r.audit.ok ? <ShieldCheck size={17} strokeWidth={1.75} className="text-safe-ink" /> : <ShieldAlert size={17} strokeWidth={1.75} className="text-danger-ink" />}Audit chain</h2>
              <div className={`mt-3 text-xl font-medium ${r.audit.ok ? "text-safe-ink" : "text-danger-ink"}`}>{r.audit.ok ? "Intact" : `Broken at entry ${r.audit.broken_at}`}</div>
              <p className="mt-2 text-sm text-muted">{r.audit.entries.toLocaleString("en-IN")} entries verified.</p>
              <p className="num mt-2 truncate text-xs text-muted" title={r.audit.head}>head {r.audit.head.slice(0, 20)}…</p>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHead title="Sessions this night" />
            {r.session_rows.length ? (
              <div className="mt-2 overflow-x-auto"><table className="data min-w-[640px]">
                <thead><tr><th>#</th><th>Vehicle</th><th>Status</th><th>Charged</th><th>Ready by</th><th className="!text-right">Spare</th><th className="!text-right">Energy</th><th className="!text-right">Cost</th></tr></thead>
                <tbody>{r.session_rows.map((s) => {
                  const spare = s.ended_at ? (Date.parse(s.ready_by) - Date.parse(s.ended_at)) / 60000 : null;
                  return (<tr key={s.id}><td className="num text-muted">{s.id}</td><td className="capitalize">{s.vehicle_type.replace("e_", "e-")}</td><td><Pill tone={s.status}>{s.status}</Pill></td>
                    <td className="num whitespace-nowrap">{time(s.started_at)}–{time(s.ended_at)}</td><td className="num">{time(s.ready_by)}</td>
                    <td className={`num text-right whitespace-nowrap ${spare != null && spare < -5 ? "text-danger-ink" : ""}`}>{spare == null ? "–" : `${spare < 0 ? "−" : ""}${minutes(spare)}`}</td>
                    <td className="num text-right">{kwh(s.delivered_wh, 2)}</td><td className="num text-right">{rupees(s.cost_paise, 2)}</td></tr>);
                })}</tbody></table></div>
            ) : <EmptyState icon={BatteryCharging} title="No sessions this night" body="Nobody charged in this window." />}
          </Card>
        </>
      )}
    </>
  );
}
