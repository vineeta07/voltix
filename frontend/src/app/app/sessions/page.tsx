"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarClock, Star } from "lucide-react";
import { useState } from "react";
import { Card, DataLabel, EmptyState, ErrorState, PageHeader, Pill, Skeleton } from "@/components/ui";
import { api, type Session } from "@/lib/api";
import { dateTime, kwh, rupees, time } from "@/lib/format";
import { useSite } from "@/lib/site";

const FILTERS = ["all", "active", "done", "cancelled"] as const;
const VEHICLE: Record<string, string> = { e_scooter: "E-scooter", e_rickshaw: "E-rickshaw", e_car: "Electric car" };

export default function SessionsPage() {
  const { site } = useSite();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const q = useQuery({ queryKey: ["sessions", site?.id], queryFn: () => api<Session[]>(`/sites/${site!.id}/sessions?limit=200`), enabled: !!site, refetchInterval: 20_000 });
  const rows = (q.data ?? []).filter((s) => filter === "all" || (filter === "active" ? ["waiting", "charging", "paused"].includes(s.status) : s.status === filter));

  return (
    <>
      <PageHeader title="Sessions" lead="Every charge at this site: what was planned, what happened, and what it cost."
        right={<div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Filter">
          {FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={clsx("h-8 rounded-md px-3 text-sm capitalize transition-colors", filter === f ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{f}</button>)}
        </div>} />
      <Card>
        {q.isLoading ? <div className="space-y-3 p-6">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : q.error ? <ErrorState error={q.error} retry={() => q.refetch()} />
          : !rows.length ? <EmptyState icon={CalendarClock} title="Nothing here yet" body="Sessions appear as soon as someone plugs in from the charging app." />
          : (
            <div className="overflow-x-auto">
              <table className="data min-w-[860px]">
                <thead><tr><th>#</th><th>Plug · user</th><th>Vehicle</th><th>Status</th><th>Plugged in</th><th>Planned</th><th>Ready by</th><th className="!text-right">Energy</th><th className="!text-right">Solar</th><th className="!text-right">Cost</th><th>Rating</th></tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const late = s.ended_at && Date.parse(s.ended_at) > Date.parse(s.ready_by) + 300000;
                    return (
                      <tr key={s.id}>
                        <td className="num text-muted">{s.id}</td>
                        <td><div className="font-medium">{s.plug_name}</div><div className="text-xs text-muted">{s.user}</div></td>
                        <td>{VEHICLE[s.vehicle_type] ?? s.vehicle_type}<div className="num text-xs text-muted">{s.power_w} W · from {s.battery_pct}%</div></td>
                        <td><div className="flex flex-wrap items-center gap-1.5"><Pill tone={s.status}>{s.status}</Pill>{s.overridden && <Pill tone="info">override</Pill>}{(s.at_risk || late) && <Pill tone="critical">{late ? "late" : "at risk"}</Pill>}{s.source === "SIMULATED" && <DataLabel kind="SIMULATED" />}</div>{s.anomaly && <div className="mt-1 max-w-[220px] text-xs text-amber-ink">{s.anomaly}</div>}</td>
                        <td className="num whitespace-nowrap">{dateTime(s.plugged_at)}</td>
                        <td className="num whitespace-nowrap">{time(s.started_at ?? s.planned_start)}–{time(s.ended_at ?? s.planned_end)}</td>
                        <td className="num">{time(s.ready_by)}</td>
                        <td className="num text-right whitespace-nowrap">{kwh(s.delivered_wh, 2)}<div className="text-xs text-muted">of {kwh(s.energy_needed_wh, 2)}</div></td>
                        <td className="num text-right">{kwh(s.solar_wh, 2)}</td>
                        <td className="num text-right">{rupees(s.cost_paise, 2)}</td>
                        <td>{s.rating ? <span className="num inline-flex items-center gap-1">{s.rating}<Star size={13} className="fill-amber text-amber" /></span> : <span className="text-muted">–</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </>
  );
}
