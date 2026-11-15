"use client";

import clsx from "clsx";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

export type BoardMode = "tod" | "voltix" | "solar";

// One night and the following day on a 20-hour axis: 20:00 -> 16:00.
const H0 = 20, SPAN = 20;
const pos = (h: number) => (((h - H0 + 24) % 24) / SPAN) * 100;
const VEHICLES = [
  { name: "Scooter", bay: "Bay 1", dur: 3, ready: 6.5, tod: 22, voltix: 22, solar: 22 },
  { name: "E-rickshaw", bay: "Bay 2", dur: 4.5, ready: 5.5, tod: 22, voltix: 22.5, solar: 22.5 },
  { name: "Scooter", bay: "Bay 3", dur: 3, ready: 7, tod: 22, voltix: 1, solar: 1 },
  { name: "E-rickshaw", bay: "Bay 4", dur: 4.5, ready: 8, tod: 22, voltix: 3, solar: 3 },
  { name: "Scooter", bay: "Bay 5", dur: 2.5, ready: 15, tod: 22, voltix: 4.25, solar: 10.5 },
  { name: "Car", bay: "Bay 6", dur: 4, ready: 15.5, tod: 22, voltix: 7.5, solar: 10.25 },
];
const BASE = 26, PER = 15, LIMIT = BASE + PER * 2 + 9; // % of the chart height
const TICKS = [20, 22, 0, 2, 4, 6, 8, 10, 12, 14, 16];

function curve(mode: BoardMode) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 80; i++) {
    const h = H0 + (i / 80) * SPAN;
    const hh = h % 24;
    const day = Math.max(0, Math.sin(((hh - 6) / 12) * Math.PI));
    let y = BASE - (hh > 6 && hh < 18 ? day * 7 : 0) + Math.exp(-((h - 20.5) ** 2) / 2) * 6;
    for (const v of VEHICLES) {
      const s = ((v[mode] - H0 + 24) % 24) + H0;
      const edge = 0.18;
      const up = Math.min(1, Math.max(0, (h - s) / edge));
      const down = Math.min(1, Math.max(0, (s + v.dur - h) / edge));
      y += PER * Math.min(up, down) * (v.name === "Car" ? 1.25 : 1);
    }
    pts.push([i / 80 * 100, y]);
  }
  return pts;
}
const toPath = (pts: [number, number][], h: number, close: boolean) => {
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${(h - (Math.min(y, 100) / 100) * h).toFixed(2)}`).join(" ");
  return close ? `${d} L100 ${h} L0 ${h} Z` : d;
};

/** The whole idea in one picture: same vehicles, same cheap rate, different start times. */
export function SignalBoard({ mode, className }: { mode: BoardMode; className?: string }) {
  const reduce = useReducedMotion();
  const pts = useMemo(() => curve(mode), [mode]);
  const peak = Math.max(...pts.map((p) => p[1]));
  const over = peak > LIMIT + 1;
  const tr = { duration: reduce ? 0 : 0.7, ease: [0.3, 0.7, 0.2, 1] as const };
  const CH = 100;

  return (
    <div className={clsx("card overflow-hidden", className)} role="img"
      aria-label={mode === "tod" ? "With a ToD timer, all six vehicles start at 22:00 and the load goes over the site limit" : "With VOLTIX, each vehicle gets its own start time and the load stays under the site limit"}>
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1" aria-hidden>
            <i className={clsx("h-2.5 w-2.5 rounded-full transition-colors duration-300", over ? "bg-danger" : "bg-line-strong")} />
            <i className={clsx("h-2.5 w-2.5 rounded-full transition-colors duration-300", mode === "voltix" ? "bg-amber" : "bg-line-strong")} />
            <i className={clsx("h-2.5 w-2.5 rounded-full transition-colors duration-300", !over ? "bg-safe" : "bg-line-strong")} />
          </span>
          <span className="text-sm font-medium">{mode === "tod" ? "ToD timer" : mode === "solar" ? "VOLTIX + solar" : "VOLTIX"}</span>
        </div>
        <span className={clsx("num rounded px-1.5 py-0.5 text-[11px] tracking-wider transition-colors duration-300", over ? "bg-danger-wash text-danger-ink" : "text-safe-ink")}>
          PEAK {Math.round((peak / LIMIT) * 100)}% OF LIMIT
        </span>
      </div>

      {/* load curve */}
      <div className="relative mx-4 mt-4 h-[104px] sm:mx-5">
        <svg viewBox={`0 0 100 ${CH}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
          <motion.path animate={{ d: toPath(pts, CH, true) }} initial={false} transition={tr} fill={over ? "var(--danger)" : "var(--teal)"} fillOpacity={0.12} style={{ transition: "fill .3s" }} />
          <motion.path animate={{ d: toPath(pts, CH, false) }} initial={false} transition={tr} fill="none" stroke={over ? "var(--danger)" : "var(--teal)"} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ transition: "stroke .3s" }} />
          <line x1="0" x2="100" y1={CH - LIMIT} y2={CH - LIMIT} stroke="var(--danger)" strokeWidth={1.25} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="num absolute right-0 text-[10px] text-danger-ink" style={{ top: `${100 - LIMIT - 15}%` }}>SITE LIMIT</span>
        <span className="num absolute bottom-1 left-0 text-[10px] text-muted">BUILDING LOAD</span>
      </div>

      {/* schedule */}
      <div className="mx-4 mt-3 mb-4 sm:mx-5">
       <div className="relative">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <span className="absolute inset-y-0 rounded-sm bg-amber/15 transition-opacity duration-500" style={{ left: `${pos(9.5)}%`, width: `${pos(15) - pos(9.5)}%`, opacity: mode === "solar" ? 1 : 0.35 }} />
          <span className="absolute inset-y-0 w-px bg-line-strong" style={{ left: `${pos(22)}%` }} />
        </div>
        {VEHICLES.map((v, i) => (
          <div key={v.bay} className="relative flex h-8 items-center border-t border-line first:border-0">
            <span className="absolute top-1.5 bottom-1.5 w-0.5 rounded bg-ink/60" style={{ left: `${pos(v.ready)}%` }} />
            <motion.span initial={false} animate={{ left: `${pos(v[mode])}%` }} transition={{ ...tr, delay: reduce ? 0 : i * 0.05 }}
              className={clsx("absolute flex h-5 items-center rounded-[5px] px-1.5 text-[10px] font-medium whitespace-nowrap text-white", mode === "tod" ? "bg-[#5A6B74]" : "bg-teal-ink dark:bg-teal")}
              style={{ width: `${(v.dur / SPAN) * 100}%` }}>
              <span className="truncate">{v.name}</span>
            </motion.span>
          </div>
        ))}
       </div>
        <div className="relative h-5 border-t border-line-strong">
          {TICKS.map((t) => <span key={t} className="num absolute top-1 -translate-x-1/2 text-[10px] text-muted" style={{ left: `${pos(t)}%` }}>{String(t).padStart(2, "0")}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5"><i className="h-3 w-px bg-line-strong" />Cheap rate begins 22:00</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-0.5 rounded bg-ink/60" />Ready-by</span>
          <span className="flex items-center gap-1.5"><i className="h-2.5 w-3 rounded-sm bg-amber/30" />Solar surplus</span>
        </div>
      </div>
    </div>
  );
}
