"use client";

import { useQuery } from "@tanstack/react-query";
import { History, Star, Sun } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, PageHeader, Pill, Skeleton, StatCard } from "@/components/ui";
import { api, type Session } from "@/lib/api";
import { day, kwh, rupees, time } from "@/lib/format";

const VEHICLE: Record<string, string> = { e_scooter: "E-scooter", e_rickshaw: "E-rickshaw", e_car: "Electric car" };

export default function HistoryPage() {
  const q = useQuery({ queryKey: ["mine"], queryFn: () => api<Session[]>("/sessions/mine") });
  const done = (q.data ?? []).filter((s) => s.status === "done");
  const onTime = done.filter((s) => s.ended_at && Date.parse(s.ended_at) <= Date.parse(s.ready_by) + 300000).length;
  return (
    <>
      <PageHeader title="History" lead="Your past charges at this site." />
      {q.isLoading ? <Skeleton className="h-64 !rounded-xl" /> : q.error ? <Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card>
        : !q.data?.length ? <Card><EmptyState icon={History} title="No charges yet" body="Your sessions appear here after your first charge." action={<Button href="/app/charge">Plug in now</Button>} /></Card> : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard label="Charges" value={done.length} />
              <StatCard label="Ready on time" text={`${onTime}/${done.length}`} value={onTime} tone={onTime === done.length ? "safe" : undefined} />
              <StatCard label="Energy" value={done.reduce((a, s) => a + s.delivered_wh, 0) / 1000} digits={1} unit="kWh" />
              <StatCard label="Spent" text={rupees(done.reduce((a, s) => a + s.cost_paise, 0))} value={1} />
            </div>
            <Card className="mt-4"><ul>
              {q.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3.5 last:border-0 sm:px-6">
                  <div className="min-w-[120px] flex-1"><div className="font-medium">{VEHICLE[s.vehicle_type]}</div><div className="num text-xs text-muted">{day(s.plugged_at)} · {time(s.started_at ?? s.planned_start)}–{time(s.ended_at ?? s.planned_end)}</div></div>
                  <Pill tone={s.status}>{s.status}</Pill>
                  <div className="num w-20 text-right text-sm">{kwh(s.delivered_wh, 2)}</div>
                  <div className="num flex w-20 items-center justify-end gap-1 text-right text-sm text-muted"><Sun size={12} />{kwh(s.solar_wh, 1)}</div>
                  <div className="num w-16 text-right text-sm">{rupees(s.cost_paise, 2)}</div>
                  <div className="num flex w-8 items-center justify-end gap-0.5 text-sm">{s.rating ?? "–"}{s.rating && <Star size={12} className="fill-amber text-amber" />}</div>
                </li>
              ))}
            </ul></Card>
          </>
        )}
    </>
  );
}
