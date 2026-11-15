"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AlertTriangle, Bike, Car, Check, Clock, PlugZap, Star, Sun, Truck, Zap } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Banner, Button, Card, DataLabel, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { api, type Me, type Plug, type Session, type Vehicles } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { kwh, nextIst, rupees, time } from "@/lib/format";
import { useLang, type Strings } from "@/lib/i18n";
import { useSite } from "@/lib/site";
import { useLiveSocket } from "@/lib/useLive";

const ICON: Record<string, typeof Bike> = { e_scooter: Bike, e_rickshaw: Truck, e_car: Car };
const CONSENT = "VOLTIX records your charging sessions (times, energy, vehicle type) to schedule charging at this site and to report anonymous totals. You can override the schedule at any time, and you can ask for your data to be deleted.";

export default function ChargePage() {
  const { lang, setLang, t } = useLang();
  const me = useMe();
  const { site } = useSite();
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["mine"], queryFn: () => api<Session[]>("/sessions/mine"), refetchInterval: 15_000 });
  useLiveSocket(site?.id, ["mine", "plugs"]);
  const [fresh, setFresh] = useState(false);
  const current = mine.data?.find((s) => ["waiting", "charging", "paused"].includes(s.status));
  const last = mine.data?.[0];
  const showDone = !fresh && !current && last && last.status === "done" && Date.now() - Date.parse(last.ended_at ?? "") < 6 * 3600000;
  const consent = useMutation({ mutationFn: () => api<Me>("/me/consent", { method: "POST", body: { accepted: true } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });

  return (
    <div className="mx-auto max-w-xl" lang={lang}>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div><h1 className="font-display text-[32px] leading-tight font-medium">{t.title}</h1><p className="mt-1 text-sm text-muted">{t.lead}</p></div>
        <div className="flex shrink-0 rounded-lg border border-line-strong p-0.5" role="group" aria-label="Language">
          {(["en", "hi"] as const).map((l) => <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={clsx("h-8 rounded-md px-2.5 text-sm transition-colors", lang === l ? "bg-ink text-paper" : "text-muted")}>{l === "en" ? "EN" : "हिं"}</button>)}
        </div>
      </header>

      {mine.isLoading || !me.data ? <Skeleton className="h-[420px] !rounded-xl" />
        : mine.error ? <Card><ErrorState error={mine.error} retry={() => mine.refetch()} /></Card>
        : !me.data.consented ? (
          <Card className="rise p-5 sm:p-6">
            <h2 className="text-lg font-semibold">{t.consentTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">{CONSENT}</p>
            <Button size="lg" className="mt-5 w-full" onClick={() => consent.mutate()} loading={consent.isPending}><Check size={18} />{t.consentAgree}</Button>
          </Card>
        ) : current ? <Active s={current} t={t} />
        : showDone ? <Done s={last!} t={t} again={() => setFresh(true)} />
        : <PlugIn t={t} lang={lang} siteId={site?.id} onDone={() => setFresh(false)} />}
    </div>
  );
}

/* ---------- step 1: one tap to plug in ---------- */
function PlugIn({ t, lang, siteId, onDone }: { t: Strings; lang: string; siteId?: number; onDone: () => void }) {
  const qc = useQueryClient();
  const vehicles = useQuery({ queryKey: ["vehicles"], queryFn: () => api<Vehicles>("/vehicles"), staleTime: Infinity });
  const plugs = useQuery({ queryKey: ["plugs", siteId], queryFn: () => api<Plug[]>(`/sites/${siteId}/plugs`), enabled: !!siteId, refetchInterval: 15_000 });
  const [vehicle, setVehicle] = useState("e_scooter");
  const [plugId, setPlugId] = useState<number | null>(null);
  const [battery, setBattery] = useState(30);
  const [ready, setReady] = useState("07:00");
  useEffect(() => { const v = localStorage.getItem("voltix.vehicle"); if (v) setVehicle(v); const r = localStorage.getItem("voltix.ready"); if (r) setReady(r); }, []);
  const create = useMutation({
    mutationFn: () => api<Session>("/sessions", { method: "POST", body: { plug_id: plugId, vehicle_type: vehicle, battery_pct: battery, ready_by: nextIst(ready) } }),
    onSuccess: () => { localStorage.setItem("voltix.vehicle", vehicle); localStorage.setItem("voltix.ready", ready); onDone(); qc.invalidateQueries({ queryKey: ["mine"] }); },
  });
  const readyIso = nextIst(ready);
  const isTomorrow = new Date(Date.parse(readyIso) + 330 * 60000).getUTCDate() !== new Date(Date.now() + 330 * 60000).getUTCDate();

  if (plugs.data && !plugs.data.length) return <Card><EmptyState icon={PlugZap} title={t.noPlugs} body="" /></Card>;
  return (
    <Card className="rise p-5 sm:p-6">
      <form onSubmit={(e) => { e.preventDefault(); if (plugId) create.mutate(); }}>
        <fieldset>
          <legend className="text-sm font-medium">{t.vehicle}</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {Object.entries(vehicles.data ?? {}).map(([k, v]) => { const I = ICON[k] ?? Bike; return (
              <button type="button" key={k} onClick={() => setVehicle(k)} aria-pressed={vehicle === k}
                className={clsx("flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border text-sm transition-colors duration-150", vehicle === k ? "border-teal bg-teal-wash font-medium text-teal-ink" : "border-line-strong text-muted hover:border-muted")}>
                <I size={24} strokeWidth={1.5} aria-hidden /><span className="px-1 text-center leading-tight">{lang === "hi" ? v.label_hi : v.label}</span></button>); })}
            {!vehicles.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[84px] !rounded-xl" />)}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">{t.plug}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(plugs.data ?? []).map((p) => { const off = p.busy || !p.online; return (
              <button type="button" key={p.id} disabled={off} onClick={() => setPlugId(p.id)} aria-pressed={plugId === p.id}
                className={clsx("flex min-h-14 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors duration-150", plugId === p.id ? "border-teal bg-teal-wash text-teal-ink" : "border-line-strong", off && "opacity-50")}>
                <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-xs text-muted">{p.busy ? t.busy : !p.online ? t.offline : t.free}</span></span>
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", p.busy ? "bg-amber" : !p.online ? "bg-grey" : "bg-safe")} /></button>); })}
            {plugs.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-14 !rounded-xl" />)}
          </div>
        </fieldset>

        <label className="mt-5 block">
          <span className="flex items-center justify-between text-sm font-medium">{t.battery}<span className="num text-base">{battery}%</span></span>
          <input type="range" min={0} max={95} step={5} value={battery} onChange={(e) => setBattery(+e.target.value)} className="mt-1 h-11 w-full accent-[#1F9E89]" />
        </label>

        <label className="mt-3 block">
          <span className="flex items-center justify-between text-sm font-medium">{t.readyBy}<span className="text-xs font-normal text-muted">{isTomorrow ? t.tomorrow : t.today} · IST</span></span>
          <input type="time" required value={ready} onChange={(e) => setReady(e.target.value)} className="input num mt-1.5 !h-14 !text-xl" />
        </label>

        {create.error && <div className="mt-4"><Banner tone="danger">{(create.error as Error).message}</Banner></div>}
        <Button size="lg" className="mt-5 w-full" disabled={!plugId} loading={create.isPending}><PlugZap size={19} />{t.plugged}</Button>
      </form>
    </Card>
  );
}

/* ---------- step 2: your slot, live progress, override ---------- */
function Active({ s, t }: { s: Session; t: Strings }) {
  const qc = useQueryClient();
  const act = useMutation({ mutationFn: (action: string) => api(`/sessions/${s.id}/override`, { method: "POST", body: { action } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["mine"] }) });
  const accept = useMutation({ mutationFn: () => api(`/sessions/${s.id}/ready-by`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["mine"] }) });
  const progress = Math.min(1, s.delivered_wh / Math.max(1, s.energy_needed_wh));
  const charging = s.status === "charging";
  return (
    <div className="grid gap-4">
      {s.at_risk && s.proposed_ready_by && (
        <Card className="rise border-danger/40 p-5">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-danger-ink" size={20} />
            <div><h2 className="font-semibold">{t.atRisk}</h2><p className="mt-1 text-sm text-muted">{t.atRiskBody} <b className="num text-ink">{time(s.proposed_ready_by)}</b>.</p></div></div>
          <div className="mt-4 grid grid-cols-2 gap-2"><Button onClick={() => accept.mutate()} loading={accept.isPending}>{t.accept}</Button><Button variant="secondary" onClick={() => act.mutate("charge_now")}>{t.keep}</Button></div>
        </Card>
      )}
      <Card className="rise overflow-hidden">
        <div className={clsx("px-5 pt-5 pb-6 sm:px-6", charging ? "bg-teal-wash" : "bg-amber-wash")}>
          <div className="flex items-center justify-between">
            <span className={clsx("flex items-center gap-2 text-sm font-medium", charging ? "text-teal-ink" : "text-amber-ink")}>
              {charging ? <Zap size={16} /> : <Clock size={16} />}{charging ? t.chargingNow : s.status === "paused" ? t.paused : t.waiting}</span>
            {s.source === "SIMULATED" && <DataLabel kind="SIMULATED" />}
          </div>
          <p className="mt-4 text-sm text-muted">{charging ? t.doneBy : t.startsAt}</p>
          <motion.p key={charging ? s.planned_end : s.planned_start} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="num text-[56px] leading-none font-medium tracking-tight">
            {time(charging ? s.planned_end : s.planned_start)}</motion.p>
          <p className="mt-2 text-base">{t.readyAt} <span className="num font-medium">{time(s.ready_by)}</span></p>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <div className="flex items-baseline justify-between text-sm"><span className="num text-base font-medium">{kwh(s.delivered_wh, 2)}</span><span className="text-muted">{t.of} <span className="num">{kwh(s.energy_needed_wh, 2)}</span></span></div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-sunk" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <motion.div className="h-full rounded-full bg-teal" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-xs text-muted">{s.plug?.name}</dt><dd className="num mt-0.5">{Math.round(s.plug?.power_w ?? 0)} W</dd></div>
            <div><dt className="text-xs text-muted">{t.cost}</dt><dd className="num mt-0.5">{rupees(s.cost_paise, 2)}</dd></div>
            <div><dt className="flex items-center gap-1 text-xs text-muted"><Sun size={12} />{t.solar}</dt><dd className="num mt-0.5">{kwh(s.solar_wh, 2)}</dd></div>
          </dl>
          {!charging && <p className="mt-4 text-sm text-muted">{t.whyWait}</p>}
          {act.error && <div className="mt-4"><Banner tone="danger">{(act.error as Error).message}</Banner></div>}
          <div className="mt-5 grid gap-2">
            {!charging && <Button size="lg" variant="secondary" onClick={() => act.mutate("charge_now")} loading={act.isPending && act.variables === "charge_now"}><Zap size={18} />{t.chargeNow}</Button>}
            <Button variant="danger" onClick={() => confirm(t.stop + "?") && act.mutate("stop")}>{t.stop}</Button>
          </div>
          <p className="mt-3 text-center text-xs text-muted">{t.overrideNote}</p>
        </div>
      </Card>
    </div>
  );
}

/* ---------- step 3: done, rate it ---------- */
function Done({ s, t, again }: { s: Session; t: Strings; again: () => void }) {
  const qc = useQueryClient();
  const rate = useMutation({ mutationFn: (rating: number) => api(`/sessions/${s.id}/rating`, { method: "POST", body: { rating } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["mine"] }) });
  return (
    <Card className="rise p-6 text-center">
      <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25, ease: "easeOut" }} className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-safe text-white"><Check size={28} /></motion.span>
      <h2 className="font-display mt-4 text-[28px] font-medium">{t.done}</h2>
      <p className="mt-1 text-sm text-muted">{t.doneBody}</p>
      <dl className="mx-auto mt-5 grid max-w-xs grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-muted">{t.delivered}</dt><dd className="num mt-0.5">{kwh(s.delivered_wh, 2)}</dd></div>
        <div><dt className="text-xs text-muted">{t.cost}</dt><dd className="num mt-0.5">{rupees(s.cost_paise, 2)}</dd></div>
        <div><dt className="text-xs text-muted">{t.readyAt}</dt><dd className="num mt-0.5">{time(s.ended_at)}</dd></div>
      </dl>
      <p className="mt-6 text-sm font-medium">{t.rate}</p>
      <div className="mt-2 flex justify-center gap-1" role="group" aria-label={t.rate}>
        {[1, 2, 3, 4, 5].map((n) => <button key={n} aria-label={`${n} / 5`} onClick={() => rate.mutate(n)} className="flex h-11 w-11 items-center justify-center rounded-lg transition-transform duration-150 hover:scale-110"><Star size={26} strokeWidth={1.5} className={clsx("transition-colors", (s.rating ?? 0) >= n ? "fill-amber text-amber" : "text-grey")} /></button>)}
      </div>
      <Button className="mt-6 w-full" size="lg" onClick={again}><PlugZap size={18} />{t.another}</Button>
    </Card>
  );
}
