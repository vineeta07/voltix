"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { DataLabel, Reveal } from "@/components/ui";

const SECTIONS = [
  ["start", "What VOLTIX does"], ["drivers", "For drivers and residents"], ["operators", "For facility managers"], ["labels", "Reading the labels"],
  ["twin", "The neighbourhood twin"], ["admin", "Setting up a site"], ["offline", "If the internet drops"], ["faq", "Questions people ask"],
] as const;

function Steps({ items }: { items: [string, string][] }) {
  return (
    <ol className="mt-4 grid gap-0">
      {items.map(([h, b], i) => (
        <li key={h} className="relative grid grid-cols-[40px_1fr] gap-x-3 pb-6 last:pb-0">
          {i < items.length - 1 && <span className="absolute top-9 bottom-0 left-[19px] w-px bg-line-strong" />}
          <span className="num flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-panel text-sm">{i + 1}</span>
          <div className="pt-1.5"><h4 className="font-semibold">{h}</h4><p className="mt-1 text-sm leading-relaxed text-muted">{b}</p></div>
        </li>
      ))}
    </ol>
  );
}
function H({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 pt-10 first:pt-0">
      <p className="eyebrow">{String(n).padStart(2, "0")}</p>
      <h2 className="font-display mt-1 text-[28px] leading-tight font-medium sm:text-[32px]">{children}</h2>
    </div>
  );
}
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 max-w-2xl leading-relaxed text-muted">{children}</p>;

export function Guide() {
  const [active, setActive] = useState<string>("start");
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-20% 0px -70% 0px" });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);
  return (
    <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
      <nav aria-label="In this guide" className="hidden lg:block">
        <div className="sticky top-24">
          <p className="eyebrow mb-3">In this guide</p>
          <ul className="border-l border-line">
            {SECTIONS.map(([id, label]) => (
              <li key={id}><a href={`#${id}`} className={clsx("-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors duration-150", active === id ? "border-teal font-medium text-ink" : "border-transparent text-muted hover:text-ink")}>{label}</a></li>
            ))}
          </ul>
        </div>
      </nav>
      <article className="min-w-0 pb-8">
        <Reveal>
          <H id="start" n={1}>What VOLTIX does</H>
          <P>Time-of-Day tariffs tell every EV owner when power is cheap, so every charger on the street switches on in the same minute. The transformer sees one sharp peak: the snapback. VOLTIX keeps everyone on the cheap rate and gives each vehicle its own start time, so the site never goes over its real capacity and everyone is still charged by the time they asked for.</P>
          <P>It only ever controls EV charging. It never touches household appliances. And if VOLTIX is unsure or offline, charging is always allowed.</P>
        </Reveal>

        <Reveal>
          <H id="drivers" n={2}>For drivers and residents</H>
          <Steps items={[
            ["Plug in your vehicle", "Connect your charger to any free bay, the way you always do."],
            ["Open My charging and tap “I've plugged in”", "Pick your vehicle, the plug you used, roughly how much battery is left, and the time you need it ready by. The app remembers your vehicle and usual time."],
            ["See your slot", "You get a start time and a ready-by time, for example “Starts at 00:40, ready by 06:10”. The plug is held off until then. The start can move earlier or later as other people plug in; your ready-by time does not move."],
            ["Watch it charge, or take over", "The page shows energy delivered, cost so far and how much came from solar. “Charge now instead” starts charging immediately, no questions asked. It is logged, and that is all."],
            ["Unplug and rate", "When the charge is done you are told, and you can leave a rating."],
          ]} />
          <div className="card mt-5 max-w-2xl p-4 text-sm leading-relaxed"><b>If your time cannot be met.</b> <span className="text-muted">VOLTIX never quietly misses a deadline. It tells you straight away, shows the earliest time it can manage, and lets you accept that or charge now anyway.</span></div>
          <P>The app has a Hindi toggle (हिं) at the top right, and you can add it to your phone&apos;s home screen from the browser menu.</P>
        </Reveal>

        <Reveal>
          <H id="operators" n={3}>For facility managers</H>
          <dl className="mt-4 grid max-w-3xl gap-x-8 gap-y-5 sm:grid-cols-2">
            {[
              ["Live site", "The measured load curve against your limit, the P50–P90 forecast band, solar export, each plug's power, and planned-versus-actual bars for every session. “Re-plan now” forces a fresh schedule."],
              ["Sessions", "Every charge with its plan, energy, solar share, cost, overrides and any anomaly flag."],
              ["Night report", "One page per night: peak against limit, ready-by times met, the tightest finish, kWh moved into solar hours, rupees saved, overrides, and the audit-chain status. Print it for the DISCOM."],
              ["Forecast", "The next 24 hours of non-EV load with accuracy scored on held-out days (pinball loss and coverage)."],
              ["Alerts", "Overloads, deadlines at risk, chargers behaving oddly, and charging with no session registered. Mark each one handled when you have dealt with it."],
              ["Audit log", "Every plan, command, override and config change, hash-chained. “Verify chain” recomputes it."],
            ].map(([h, b]) => <div key={h} className="border-t border-line-strong pt-3"><dt className="font-semibold">{h}</dt><dd className="mt-1 text-sm leading-relaxed text-muted">{b}</dd></div>)}
          </dl>
          <P>When measured load goes over the limit, VOLTIX first delays sessions that have not started. It pauses a running session only if that charger supports pausing (OCPP cars), and only as a last resort. Lead-acid e-rickshaw packs are never interrupted mid-charge.</P>
        </Reveal>

        <Reveal>
          <H id="labels" n={4}>Reading the labels</H>
          <P>Every number says where it came from. Nothing modelled or simulated is ever presented as measured.</P>
          <ul className="mt-4 grid max-w-2xl gap-3">
            {([["MEASURED", "Read from your real meter or a real smart plug."], ["FORECAST", "A prediction, such as tomorrow's building load."], ["MODELLED", "Calculated: the twin's households, counterfactual baselines, transformer temperatures."], ["SIMULATED", "Produced by the built-in simulator when no hardware is connected. Used for demos and tests only."]] as const).map(([k, b]) => (
              <li key={k} className="flex items-start gap-3"><span className="mt-0.5 w-24 shrink-0"><DataLabel kind={k} /></span><span className="text-sm leading-relaxed text-muted">{b}</span></li>
            ))}
          </ul>
        </Reveal>

        <Reveal>
          <H id="twin" n={5}>The neighbourhood twin</H>
          <P>The twin asks: what if this whole transformer had EVs? It adds modelled homes and EVs to your building&apos;s load and runs five strategies through the same scheduler and an IEC 60076-7 thermal model of the transformer.</P>
          <ul className="mt-4 max-w-2xl text-sm">
            {[["Uncontrolled", "everyone starts on plug-in"], ["ToD timer", "everyone starts when the cheap rate begins"], ["Random delay", "a timer plus a random delay"], ["Site limit only", "first come, first served under the limit"], ["VOLTIX", "each vehicle gets its own start time"]].map(([a, b]) => <li key={a} className="flex gap-3 border-b border-line py-2.5 last:border-0"><b className="w-32 shrink-0">{a}</b><span className="text-muted">{b}</span></li>)}
          </ul>
          <P>The headline is the share of homes with an EV at which each strategy first overloads the transformer. Drag the adoption slider to see the day&apos;s loading and hot-spot temperature for any level.</P>
        </Reveal>

        <Reveal>
          <H id="admin" n={6}>Setting up a site</H>
          <Steps items={[
            ["Create the site and set its limit", "Admin → Site & limits. Enter the sanctioned load or breaker rating in kVA, a safety margin, and the power factor."],
            ["Add the meter", "Admin → Plugs & meters. Give the MQTT topic your supply meter publishes on. It should send JSON with a signed power value in watts; negative means export."],
            ["Pair the smart plugs", "Power up each Tasmota plug on the site's broker. It shows up under “Seen on the broker” within a minute. Click it, name the bay, set its maximum watts, and pair."],
            ["Enter the tariff", "Admin → Tariff. Copy the ToD windows from your DISCOM's current order."],
            ["Give people roles", "Admin → Users & consent. Everyone who signs in starts as a user; promote facility managers to operator."],
          ]} />
        </Reveal>

        <Reveal>
          <H id="offline" n={7}>If the internet drops</H>
          <P>A small edge agent runs on a Raspberry Pi at the site, next to the MQTT broker. If it loses the cloud, it keeps running the last valid schedule. If it has no schedule at all, it switches every plug on. People can always charge.</P>
        </Reveal>

        <Reveal>
          <H id="faq" n={8}>Questions people ask</H>
          <dl className="mt-4 max-w-2xl">
            {[
              ["Will my vehicle be charged in time?", "Meeting your ready-by time is the first rule of the scheduler, ahead of everything else. If it truly cannot be met, you are told immediately."],
              ["Does waiting cost me more?", "No. Your slot is placed in cheaper hours wherever possible, and in solar hours for vehicles parked in the day."],
              ["Can I just charge right now?", "Yes, always. Tap “Charge now instead”."],
              ["What do you record about me?", "Session times, energy and vehicle type. The public impact page shows totals only, with no personal data."],
              ["Does an AI decide when I charge?", "No. Scheduling is deterministic optimisation code. Forecasts inform it, and the optional assistant can only read reports; neither can switch a plug."],
            ].map(([q, a]) => <div key={q} className="border-b border-line py-4 first:pt-0 last:border-0"><dt className="font-semibold">{q}</dt><dd className="mt-1 text-sm leading-relaxed text-muted">{a}</dd></div>)}
          </dl>
        </Reveal>
      </article>
    </div>
  );
}
