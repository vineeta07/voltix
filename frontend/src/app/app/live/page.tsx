"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellOff, Check, Gauge, Plug as PlugIcon, RefreshCw, Sun, Zap } from "lucide-react";
import { useState } from "react";
import { LoadChart } from "@/components/charts";
import { SessionTimeline } from "@/components/SessionTimeline";
import { Banner, Button, Card, CardHead, DataLabel, EmptyState, ErrorState, LiveBadge, PageHeader, PageSkeleton, Pill, StatCard } from "@/components/ui";
import { api, type Live } from "@/lib/api";
import { ago, kw, time, watts } from "@/lib/format";
import { useSite } from "@/lib/site";
import { useLiveSocket } from "@/lib/useLive";

export default function LivePage() {
  const { site } = useSite();
  const [hours, setHours] = useState(6);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["live", site?.id, hours],
    queryFn: () => api<Live>(`/sites/${site!.id}/live?hours=${hours}`),
    enabled: !!site, refetchInterval: 10_000, placeholderData: (p) => p,
  });
  const socket = useLiveSocket(site?.id, ["live"]);
  const replan = useMutation({ mutationFn: () => api(`/sites/${site!.id}/replan`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }) });
  const resolve = useMutation({ mutationFn: (id: number) => api(`/alerts/${id}/resolve`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }) });

  if (q.isLoading || !site) return (<><PageHeader title="Live site" /><PageSkeleton /></>);
  if (q.error || !q.data) return (<><PageHeader title="Live site" /><Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card></>);

  const d = q.data;
  const m = d.measured;
  const src = m?.source ?? d.history_source;
  const used = m ? (m.load_w / d.limit_w) * 100 : null;
  const open = d.alerts.filter((a) => !a.resolved);
  const active = d.sessions.filter((s) => ["waiting", "charging", "paused"].includes(s.status));
  const plugNames = Object.fromEntries(d.plugs.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader title="Live site" lead={`${d.site.name} · limit ${(d.site.limit_va / 1000).toFixed(1)} kVA · ${d.tariff_now.label} rate ₹${(d.tariff_now.paise_per_kwh / 100).toFixed(2)}/kWh`}
        right={<><LiveBadge live={!!m} label={m ? (socket ? "LIVE" : "LIVE · POLLING") : "NO DATA"} /><Button variant="secondary" size="sm" onClick={() => replan.mutate()} loading={replan.isPending}><RefreshCw size={15} />Re-plan now</Button></>} />

      {!m && <div className="mb-4"><Banner tone="amber">No meter reading in the last 5 minutes. VOLTIX fails open: plugs stay on and people can charge. Check the meter and the MQTT link.</Banner></div>}
      {d.plan && !d.plan.feasible && <div className="mb-4"><Banner tone="danger">The current plan cannot meet every ready-by time. See the alerts below for the smallest change that fixes it.</Banner></div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={Gauge} label="Site load" value={m ? m.load_w / 1000 : null} digits={2} unit="kW" source={src}
          tone={used != null && used > 100 ? "danger" : undefined} hint={used != null ? `${used.toFixed(0)}% of the ${kw(d.limit_w)} limit` : "Waiting for the meter"} />
        <StatCard icon={Zap} label="EV charging" value={m ? m.ev_w / 1000 : null} digits={2} unit="kW" source={src} hint={`${active.filter((s) => s.status === "charging").length} charging · ${active.filter((s) => s.status !== "charging").length} waiting`} />
        <StatCard icon={Sun} label="Solar surplus" value={m ? m.surplus_w / 1000 : null} digits={2} unit="kW" source={src} hint={m && m.export_w > 0 ? `${watts(m.export_w)} going back to the grid` : "Nothing exported right now"} />
        <StatCard icon={PlugIcon} label="Headroom for EVs" value={d.plan?.capacity_w?.[0] != null ? d.plan.capacity_w[0] / 1000 : null} digits={2} unit="kW" source="FORECAST" hint="Limit − P90 non-EV load − margin" />
      </div>

      <Card className="mt-4">
        <CardHead title="Load against the limit" hint={m ? `Last reading ${ago(m.ts)} · forecast by ${d.forecast.method}` : undefined}
          right={<><DataLabel kind={d.history_source} /><DataLabel kind="FORECAST" />
            <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Time range">
              {[2, 6, 24].map((h) => <button key={h} onClick={() => setHours(h)} aria-pressed={hours === h} className={clsx("num h-7 rounded-md px-2.5 text-xs transition-colors", hours === h ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{h} h</button>)}
            </div></>} />
        <div className="px-2 pt-3 pb-3 sm:px-4">
          {d.history.length ? <LoadChart live={d} /> : <EmptyState icon={Gauge} title="No telemetry yet" body="Once the meter publishes over MQTT, the live load curve draws here." />}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHead title="Sessions: planned vs actual" hint={d.plan ? `Plan #${d.plan.id} · ${d.plan.reason} · ${time(d.plan.created_at)} IST` : "No plan yet"} />
          <div className="pt-4"><SessionTimeline sessions={d.sessions.filter((s) => s.status !== "cancelled")} now={d.now} plugNames={plugNames} /></div>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHead title="Plugs" right={<DataLabel kind={d.plugs.some((p) => p.source === "SIMULATED") ? "SIMULATED" : "MEASURED"} />} />
            {d.plugs.length ? (
              <ul className="px-4 pt-2 pb-3 sm:px-6">
                {d.plugs.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                    <span className={clsx("h-2 w-2 shrink-0 rounded-full", !p.online ? "bg-grey" : p.power_w > 20 ? "bg-teal" : p.is_on ? "bg-safe" : "bg-amber")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{!p.online ? "Offline" : p.power_w > 20 ? "Charging" : p.is_on ? "On, idle" : "Held until its start time"}</div>
                    </div>
                    <div className="num text-right text-sm">{watts(p.power_w)}</div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={PlugIcon} title="No plugs paired" body="An admin can pair smart plugs by their MQTT topic." />}
          </Card>

          <Card>
            <CardHead title="Alerts" hint={open.length ? `${open.length} open` : undefined} />
            {open.length ? (
              <ul className="px-4 pt-2 pb-3 sm:px-6">
                {open.map((a) => (
                  <li key={a.id} className="rise border-b border-line py-3 last:border-0">
                    <div className="flex items-center justify-between gap-2"><Pill tone={a.level}>{a.kind.replaceAll("_", " ")}</Pill><span className="num text-xs text-muted">{time(a.ts)}</span></div>
                    <p className="mt-1.5 text-sm">{a.message}</p>
                    <button onClick={() => resolve.mutate(a.id)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-teal-ink hover:underline"><Check size={13} />Mark as handled</button>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={BellOff} title="All clear" body="No open alerts. Overloads, at-risk deadlines and charger anomalies show up here." />}
          </Card>
        </div>
      </div>
    </>
  );
}
