"use client";

import clsx from "clsx";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type { Session } from "@/lib/api";
import { time } from "@/lib/format";

const VEHICLE: Record<string, string> = { e_scooter: "Scooter", e_rickshaw: "E-rickshaw", e_car: "Car" };

/** Planned vs actual for each session, on one shared time axis. */
export function SessionTimeline({ sessions, now, plugNames }: { sessions: Session[]; now: string; plugNames?: Record<number, string> }) {
  if (!sessions.length) {
    return <EmptyState icon={CalendarClock} title="No sessions yet" body="When someone plugs in and sets a ready-by time, their planned and actual charging appears here." />;
  }
  const nowT = Date.parse(now);
  const times = sessions.flatMap((s) => [s.plugged_at, s.ready_by, s.planned_end, s.ended_at].filter(Boolean).map((t) => Date.parse(t as string)));
  const hour = 3600000;
  const min = Math.floor(Math.min(...times, nowT - hour) / hour) * hour;
  const max = Math.ceil(Math.max(...times, nowT + hour) / hour) * hour;
  const span = max - min;
  const x = (t: number) => `${(((t - min) / span) * 100).toFixed(3)}%`;
  const w = (a: number, b: number) => `${((Math.max(0, b - a) / span) * 100).toFixed(3)}%`;
  const step = Math.max(1, Math.ceil(span / hour / 8)); // at most about eight labels
  const ticks: number[] = [];
  for (let t = min; t <= max; t += hour * step) ticks.push(t);

  return (
    <div className="overflow-x-auto px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="min-w-[560px]">
        <div className="relative ml-[136px] h-6 border-b border-line">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2 text-[11px] text-muted" style={{ left: x(t) }}>{time(new Date(t).toISOString())}</span>
          ))}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-[136px] right-0">
            {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: x(t) }} />)}
            <span className="absolute inset-y-0 z-10 w-px bg-ink" style={{ left: x(nowT) }}>
              <span className="num absolute -top-0.5 left-1 rounded bg-ink px-1 text-[10px] text-paper">now</span>
            </span>
          </div>
          {sessions.map((s) => {
            const start = Date.parse(s.started_at ?? s.planned_start ?? s.plugged_at);
            const pStart = s.planned_start ? Date.parse(s.planned_start) : start;
            const pEnd = s.planned_end ? Date.parse(s.planned_end) : pStart;
            const aEnd = s.ended_at ? Date.parse(s.ended_at) : s.status === "charging" ? nowT : null;
            return (
              <div key={s.id} className="flex h-14 items-center border-b border-line last:border-0">
                <div className="w-[136px] shrink-0 pr-3">
                  <div className="truncate text-sm font-medium">{plugNames?.[s.plug_id] ?? `Plug ${s.plug_id}`}</div>
                  <div className="truncate text-xs text-muted">{VEHICLE[s.vehicle_type] ?? s.vehicle_type}{s.user ? ` · ${s.user}` : ""}</div>
                </div>
                <div className="relative h-full flex-1">
                  {/* plugged-in window */}
                  <span className="absolute top-1/2 h-px -translate-y-1/2 bg-line-strong" style={{ left: x(Date.parse(s.plugged_at)), width: w(Date.parse(s.plugged_at), Date.parse(s.ready_by)) }} />
                  {/* planned */}
                  <span title={`Planned ${time(s.planned_start)}–${time(s.planned_end)}`}
                    className={clsx("absolute top-[11px] h-[14px] rounded-[4px] border transition-all duration-300", s.at_risk ? "border-danger bg-danger-wash" : "border-amber bg-amber-wash")}
                    style={{ left: x(pStart), width: w(pStart, pEnd) }} />
                  {/* actual */}
                  {s.started_at && aEnd && (
                    <span title={`Charged ${time(s.started_at)}–${s.ended_at ? time(s.ended_at) : "now"}`}
                      className={clsx("absolute top-[29px] h-[14px] rounded-[4px] transition-all duration-300", s.status === "done" ? "bg-teal/70" : "bg-teal")}
                      style={{ left: x(start), width: w(start, aEnd) }} />
                  )}
                  {/* ready-by */}
                  <span title={`Ready by ${time(s.ready_by)}`} className="absolute top-2 bottom-2 w-0.5 rounded bg-ink" style={{ left: x(Date.parse(s.ready_by)) }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 ml-[136px] flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px] border border-amber bg-amber-wash" />Planned</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-4 rounded-[3px] bg-teal" />Actual</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-0.5 rounded bg-ink" />Ready-by time</span>
          <span className="flex items-center gap-1.5"><i className="h-px w-4 bg-line-strong" />Plugged in</span>
        </div>
      </div>
    </div>
  );
}
