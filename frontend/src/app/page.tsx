"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity, ArrowRight, BellRing, Building2, CloudOff, FileCheck2, Hand, Languages, LineChart, Network,
  ShieldCheck, Sun, Thermometer, TimerReset, Truck, Zap,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { StrategyDayChart } from "@/components/charts";
import { PilotPhotos } from "@/components/landing/PilotPhotos";
import { SignalBoard, type BoardMode } from "@/components/landing/SignalBoard";
import { PublicFooter, PublicNav } from "@/components/PublicShell";
import { Button, CountUp, DataLabel, Reveal, Skeleton } from "@/components/ui";
import { api, type Impact, type TwinLevel } from "@/lib/api";

const STORY: { mode: BoardMode; k: string; h: string; b: string }[] = [
  { mode: "tod", k: "The problem", h: "Cheap power starts at one minute. So does every charger.", b: "Time-of-Day tariffs reward charging off-peak. Timers do exactly what they are told, and six vehicles on one building switch on together. The transformer sees a new peak that the tariff created. It is called snapback." },
  { mode: "voltix", k: "The signal", h: "Same cheap rate. Each vehicle gets its own green light.", b: "You plug in and say when you need it. VOLTIX places your charge so the site stays under its real limit and you are ready on time. Start times move; ready-by times do not." },
  { mode: "solar", k: "The sun", h: "Parked in the day? Charge on the surplus.", b: "The meter sees when rooftop solar is flowing back to the grid. Vehicles that are parked through the day are pulled into those hours, so the energy is used where it is made." },
];

export default function Landing() {
  const impact = useQuery({ queryKey: ["impact"], queryFn: () => api<Impact>("/impact"), refetchInterval: 60_000 });
  const snap = useQuery({ queryKey: ["snapback"], queryFn: () => api<TwinLevel>("/snapback"), staleTime: Infinity });
  const reduce = useReducedMotion();
  const [picked, setHero] = useState<BoardMode>("tod");
  const [auto, setAuto] = useState(true);
  // With reduced motion there is no auto-play: show the VOLTIX state until the visitor picks one.
  const hero: BoardMode = auto && reduce ? "voltix" : picked;
  useEffect(() => {
    if (!auto || reduce) return;
    const id = setInterval(() => setHero((m) => (m === "tod" ? "voltix" : "tod")), 3800);
    return () => clearInterval(id);
  }, [auto, reduce]);

  const [step, setStep] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setStep(Number((e.target as HTMLElement).dataset.i))), { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const i = impact.data;
  const tod = snap.data?.strategies.tod_timer, vx = snap.data?.strategies.voltix;

  return (
    <>
      <PublicNav />
      <main>
        {/* ---------------- hero ---------------- */}
        <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-4 pt-10 pb-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:px-8 lg:pt-20 lg:pb-24">
          <div>
            <p className="eyebrow settle">The traffic signal for EV charging</p>
            <h1 className="settle font-display mt-4 text-[40px] leading-[1.05] font-medium sm:text-[56px] lg:text-[68px]">
              Tariffs tell every EV when power is cheap. Nobody tells them <em className="text-teal-ink">not all at once.</em>
            </h1>
            <p style={{ animationDelay: "0.06s" }} className="settle mt-6 max-w-xl text-lg leading-relaxed text-muted">
              VOLTIX gives each vehicle on a shared transformer its own start time. Everyone keeps the cheap rate and their ready-by time, and the site never goes over its real capacity.
            </p>
            <div style={{ animationDelay: "0.12s" }} className="settle mt-8 flex flex-wrap gap-3">
              <Button href="/signin" size="lg">Open VOLTIX<ArrowRight size={18} /></Button>
              <Button href="#what" size="lg" variant="secondary">See how it works</Button>
            </div>
          </div>
          <div style={{ animationDelay: "0.1s" }} className="settle">
            <SignalBoard mode={hero} />
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="Compare">
                {(["tod", "voltix"] as const).map((m) => <button key={m} aria-pressed={hero === m} onClick={() => { setAuto(false); setHero(m); }} className={clsx("h-8 rounded-md px-3 text-sm transition-colors duration-150", hero === m ? "bg-ink text-paper" : "text-muted hover:text-ink")}>{m === "tod" ? "ToD timer" : "VOLTIX"}</button>)}
              </div>
              <span className="text-xs text-muted">Illustration of one building. Same six vehicles, same tariff.</span>
            </div>
          </div>
        </section>

        {/* ---------------- live numbers ---------------- */}
        <section className="border-y border-line bg-panel" aria-label="Live impact">
          <div className="mx-auto grid max-w-[1280px] divide-y divide-line px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 lg:px-8">
            {[
              { label: "Ready-by times met", v: i?.deadlines_met_pct, d: 0, u: "%", hint: i ? `${i.deadlines_met} of ${i.sessions} sessions` : "" },
              { label: "Energy delivered", v: i?.kwh_measured, d: 1, u: "kWh", hint: i ? `${i.kwh_solar} kWh of it from solar surplus` : "" },
              { label: "Lower peak than a ToD timer", v: i?.peak_reduction_pct_vs_tod, d: 0, u: "%", hint: i ? `average over ${i.nights_compared} nights` : "" },
            ].map((s) => (
              <div key={s.label} className="px-0 py-7 sm:px-8 sm:first:pl-0 sm:last:pr-0">
                <div className="flex items-center justify-between gap-2"><span className="text-sm text-muted">{s.label}</span>{i && <DataLabel kind={s.label.startsWith("Lower") ? "MODELLED" : i.source} />}</div>
                <div className="num mt-3 h-12 text-[44px] leading-none font-medium">
                  {impact.isLoading ? <Skeleton className="h-11 w-32" /> : s.v == null ? <span className="text-muted">–</span> : <><CountUp value={s.v} digits={s.d} /><span className="ml-1.5 text-base font-normal text-muted">{s.u}</span></>}
                </div>
                <p className="mt-2 h-4 text-xs text-muted">{impact.error ? "Live numbers are unavailable right now" : s.hint}</p>
              </div>
            ))}
          </div>
        </section>

        <PilotPhotos />

        {/* ---------------- scroll story ---------------- */}
        <section id="what" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 pt-16 sm:px-6 lg:px-8 lg:pt-28">
          <Reveal><p className="eyebrow">01 — What it is</p><h2 className="font-display mt-3 max-w-2xl text-[32px] leading-[1.1] font-medium sm:text-[44px]">Scroll through one night on one building.</h2></Reveal>
          <div className="mt-8 grid gap-x-14 lg:mt-4 lg:grid-cols-[1fr_1.05fr]">
            <div className="sticky top-16 z-10 -mx-4 bg-paper px-4 pt-2 pb-3 sm:-mx-6 sm:px-6 lg:order-2 lg:top-24 lg:mx-0 lg:self-start lg:bg-transparent lg:p-0">
              <SignalBoard mode={STORY[step].mode} />
              <div className="mt-3 flex gap-1.5" aria-hidden>{STORY.map((_, n) => <span key={n} className={clsx("h-1 flex-1 rounded-full transition-colors duration-300", n <= step ? "bg-teal" : "bg-line-strong")} />)}</div>
            </div>
            <div className="lg:order-1">
              {STORY.map((s, n) => (
                <div key={s.k} data-i={n} ref={(el) => { refs.current[n] = el; }} className="flex min-h-[58vh] flex-col justify-center py-10 lg:min-h-[78vh]">
                  <div className={clsx("transition-opacity duration-300", step === n ? "opacity-100" : "opacity-60")}>
                    <p className="num text-sm text-teal-ink">{String(n + 1).padStart(2, "0")} · {s.k}</p>
                    <h3 className="font-display mt-2 text-[28px] leading-[1.15] font-medium sm:text-[36px]">{s.h}</h3>
                    <p className="mt-4 max-w-md leading-relaxed text-muted">{s.b}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- how it works ---------------- */}
        <section id="how" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <Reveal><p className="eyebrow">02 — How it works</p><h2 className="font-display mt-3 max-w-2xl text-[32px] leading-[1.1] font-medium sm:text-[44px]">Three steps. The first one is yours.</h2></Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3">
            {[
              ["Plug in and set a time", "Open the app, tap “I've plugged in”, and choose when you need the vehicle. That is all a driver ever does.", "Starts at 00:40, ready by 06:10"],
              ["VOLTIX finds your slot", "A scheduler weighs every vehicle against the building's measured load and tomorrow's forecast, then switches each smart plug on at its own minute.", "Re-solved every 15 min"],
              ["Everyone is ready on time", "The site stays under its limit, daytime vehicles ride the solar surplus, and the facility manager gets a verified report each morning.", "Hash-chained audit log"],
            ].map(([h, b, tag], n) => (
              <Reveal key={h} delay={n * 0.08} className="bg-panel p-6 sm:p-8">
                <span className="font-display text-[56px] leading-none text-line-strong">{n + 1}</span>
                <h3 className="mt-5 text-xl font-semibold">{h}</h3>
                <p className="mt-2 leading-relaxed text-muted">{b}</p>
                <p className="num mt-5 inline-block rounded border border-line-strong px-2 py-1 text-xs">{tag}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------------- snapback chart ---------------- */}
        <section id="proof" className="scroll-mt-16 border-y border-line bg-panel">
          <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.4fr] lg:px-8 lg:py-24">
            <Reveal>
              <p className="eyebrow">03 — The snapback</p>
              <h2 className="font-display mt-3 text-[32px] leading-[1.1] font-medium sm:text-[44px]">One transformer, 30% of homes with an EV.</h2>
              <p className="mt-4 leading-relaxed text-muted">The neighbourhood twin scales the same logic to a whole distribution transformer and runs it through an IEC 60076-7 thermal model.</p>
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5">
                {[["Peak, ToD timer", tod ? `${tod.peak_pct.toFixed(0)}%` : "–", tod && tod.peak_pct > 100], ["Peak, VOLTIX", vx ? `${vx.peak_pct.toFixed(0)}%` : "–", false], ["Hot-spot, ToD timer", tod ? `${tod.max_hot_spot_c.toFixed(0)} °C` : "–", tod && tod.max_hot_spot_c > 98], ["Hot-spot, VOLTIX", vx ? `${vx.max_hot_spot_c.toFixed(0)} °C` : "–", false]].map(([k, v, bad]) => (
                  <div key={k as string} className="border-t border-line-strong pt-3"><dt className="text-sm text-muted">{k}</dt><dd className={clsx("num mt-1 text-[28px] leading-none font-medium", bad && "text-danger-ink")}>{v}</dd></div>
                ))}
              </dl>
              <p className="mt-6 text-xs text-muted">Of transformer rating. {snap.data?.household_source?.includes("placeholder") ? "Household profiles are a synthetic placeholder until CEEW smart-meter data is loaded." : "Households from CEEW smart-meter data."}</p>
            </Reveal>
            <Reveal delay={0.1}>
              <div className="flex items-center justify-between"><h3 className="font-semibold">Transformer loading through the night</h3><DataLabel kind="MODELLED" /></div>
              <div className="mt-3">{snap.data ? <StrategyDayChart level={snap.data} show={["tod_timer", "voltix"]} height={380} /> : snap.error ? <p className="py-24 text-center text-sm text-muted">The chart could not load. It needs the VOLTIX API.</p> : <Skeleton className="h-[380px]" />}</div>
            </Reveal>
          </div>
        </section>

        {/* ---------------- features ---------------- */}
        <section id="features" className="mx-auto max-w-[1280px] scroll-mt-16 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <Reveal><p className="eyebrow">04 — What is inside</p><h2 className="font-display mt-3 max-w-2xl text-[32px] leading-[1.1] font-medium sm:text-[44px]">Built like a utility would want it built.</h2></Reveal>
          <div className="mt-10 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [TimerReset, "Deadline-first scheduling", "A constraint solver meets every ready-by time first, then lowers the peak, uses solar, cuts cost, and keeps turns fair."],
              [Activity, "Live from real hardware", "A bidirectional IoT meter and Tasmota smart plugs report over MQTT. The live view updates over WebSocket."],
              [LineChart, "P50 / P90 load forecast", "LightGBM predicts the building's non-EV load 24 hours ahead. Plans are made against P90, not the average."],
              [Sun, "Solar-surplus charging", "Measured export tells VOLTIX when rooftop solar is going spare, and daytime vehicles move into it."],
              [Thermometer, "Transformer thermal twin", "IEC 60076-7 top-oil and hot-spot temperatures, ageing rate, and the rupee value of insulation life."],
              [Network, "Neighbourhood what-if", "Five strategies across 5–40% EV adoption, and the adoption level at which each one first overloads."],
              [Hand, "Override, always", "One tap to charge now. Never blocked, always logged."],
              [CloudOff, "Fails open", "If the cloud link drops, the edge agent runs the last plan. With no plan, every plug is on."],
              [ShieldCheck, "Tamper-evident audit log", "Every plan, command and override is hash-chained and can be verified by anyone."],
              [BellRing, "Charger health alerts", "Flags stalled charges and unusual draw, which matters for lead-acid e-rickshaw packs."],
              [FileCheck2, "A report the DISCOM can read", "Peak against limit, deadlines met and kWh shifted, every morning, with its data source labelled."],
              [Languages, "English and Hindi", "The driver app is one screen, works on any phone, and installs to the home screen."],
            ].map(([Icon, h, b], n) => {
              const I = Icon as typeof Zap;
              return (
                <Reveal key={h as string} delay={(n % 3) * 0.06} className="group border-t border-line-strong py-6">
                  <I size={22} strokeWidth={1.5} className="text-teal-ink transition-transform duration-200 group-hover:-translate-y-0.5" aria-hidden />
                  <h3 className="mt-3 font-semibold">{h as string}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{b as string}</p>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* ---------------- who it's for ---------------- */}
        <section id="who" className="scroll-mt-16 bg-[#0F2A3A] text-[#EEF3F2]">
          <div className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <Reveal><p className="font-mono text-xs tracking-[0.08em] text-white/55 uppercase">05 — Who it is for</p><h2 className="font-display mt-3 max-w-2xl text-[32px] leading-[1.1] font-medium sm:text-[44px]">Three people, one schedule.</h2></Reveal>
            <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-white/15">
              {[
                [Building2, "For societies", "Add EV chargers without a transformer upgrade.", ["Total load stays under your sanctioned limit", "Every resident is charged by their ready-by time", "A facility manager can run it from one screen"]],
                [Truck, "For drivers", "Cheaper charging, and never stranded in the morning.", ["E-rickshaw and scooter charging shifts into solar and off-peak hours", "A Delhi BSES–CEEW pilot saw about 13% lower cost from shifting", "Lead-acid packs are never interrupted mid-charge"]],
                [Zap, "For DISCOMs", "EV growth without the snapback peak.", ["A verified nightly report per site", "Measured, modelled and forecast values kept apart", "Evidence for where transformers can wait, and where they cannot"]],
              ].map(([Icon, k, h, pts], n) => {
                const I = Icon as typeof Zap;
                return (
                  <Reveal key={k as string} delay={n * 0.08} className="lg:px-10 lg:first:pl-0 lg:last:pr-0">
                    <I size={26} strokeWidth={1.25} className="text-[#6FD3C1]" aria-hidden />
                    <p className="mt-5 font-mono text-xs tracking-[0.08em] text-white/55 uppercase">{k as string}</p>
                    <h3 className="font-display mt-2 text-[26px] leading-tight font-medium">{h as string}</h3>
                    <ul className="mt-5 space-y-3 text-sm leading-relaxed text-white/75">{(pts as string[]).map((p) => <li key={p} className="flex gap-3"><span className="mt-2 h-1 w-3 shrink-0 rounded-full bg-[#1F9E89]" />{p}</li>)}</ul>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------------- honest limits ---------------- */}
        <section className="mx-auto max-w-[1280px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <Reveal><p className="eyebrow">06 — Honest limits</p><h2 className="font-display mt-3 text-[32px] leading-[1.1] font-medium sm:text-[44px]">What this is, and what it is not yet.</h2></Reveal>
            <Reveal delay={0.08}>
              <ul className="divide-y divide-line border-y border-line">
                {[
                  ["Real", "The pilot runs on one DTU building: a real meter, real smart plugs, real users entering real deadlines."],
                  ["Modelled", "The neighbourhood transformer. Its households come from CEEW smart-meter profiles, not from meters we installed."],
                  ["Small", "One site. Results from a handful of chargers do not prove behaviour at feeder scale."],
                  ["Simple chargers", "Smart plugs can only switch on and off. Variable power needs an OCPP charger."],
                  ["Config, not law", "Tariff windows and transformer constants are entered from published documents and must be kept current."],
                ].map(([k, b]) => <li key={k} className="grid gap-1 py-4 sm:grid-cols-[150px_1fr] sm:gap-6"><span className="num text-sm text-teal-ink">{k}</span><span className="leading-relaxed text-muted">{b}</span></li>)}
              </ul>
            </Reveal>
          </div>
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="border-t border-line">
          <Reveal className="mx-auto max-w-[1280px] px-4 py-16 text-center sm:px-6 lg:px-8 lg:py-24">
            <h2 className="font-display mx-auto max-w-2xl text-[36px] leading-[1.08] font-medium sm:text-[52px]">Give every charger its own green light.</h2>
            <div className="mt-8 flex flex-wrap justify-center gap-3"><Button href="/signin" size="lg">Open VOLTIX<ArrowRight size={18} /></Button><Button href="/guide" size="lg" variant="secondary">Read the user guide</Button></div>
          </Reveal>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
