"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Plus, Radio, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner, Button, Card, CardHead, DataLabel, EmptyState, ErrorState, Field, PageHeader, Pill, Skeleton } from "@/components/ui";
import { api, type Plug, type Role, type Site } from "@/lib/api";
import { ago, dateTime } from "@/lib/format";

type Devices = { plugs: Plug[]; meters: { id: number; site_id: number; name: string; topic: string; last_seen: string | null }[]; unpaired: { name: string; kind: string; topic: string; last_seen: string }[] };
type UserRow = { id: number; email: string; name: string; role: Role; consent_at: string | null; created_at: string; sessions: number; overrides: number };
const TABS = ["Site & limits", "Plugs & meters", "Tariff", "Transformer", "Users & consent"] as const;

export default function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Site & limits");
  const sites = useQuery({ queryKey: ["admin-sites"], queryFn: () => api<Site[]>("/admin/sites") });
  const site = sites.data?.[0];
  return (
    <>
      <PageHeader title="Admin" lead="Sites, limits, devices, tariff and people. Every change here is written to the audit log." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx("relative h-11 shrink-0 px-3 text-sm transition-colors", tab === t ? "font-medium text-ink" : "text-muted hover:text-ink")}>{t}{tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-teal" />}</button>)}
      </div>
      {sites.isLoading ? <Skeleton className="h-64 !rounded-xl" /> : sites.error ? <Card><ErrorState error={sites.error} retry={() => sites.refetch()} /></Card> : (
        <div key={tab} className="rise">
          {tab === "Site & limits" && <SiteTab site={site} />}
          {tab === "Plugs & meters" && <DevicesTab site={site} />}
          {tab === "Tariff" && (site ? <TariffTab site={site} /> : <NoSite />)}
          {tab === "Transformer" && (site ? <TransformerTab site={site} /> : <NoSite />)}
          {tab === "Users & consent" && <UsersTab />}
        </div>
      )}
    </>
  );
}
const NoSite = () => <Card><EmptyState icon={Radio} title="Add a site first" body="Create the site under Site & limits, then come back here." /></Card>;

function useSave(path: string, method = "PATCH") {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: unknown) => api(path, { method, body }), onSuccess: () => qc.invalidateQueries() });
}
function Saved({ m }: { m: { isSuccess: boolean; error: unknown } }) {
  if (m.error) return <span className="text-sm text-danger-ink">{(m.error as Error).message}</span>;
  if (m.isSuccess) return <span className="rise text-sm text-safe-ink">Saved</span>;
  return null;
}

function SiteTab({ site }: { site?: Site }) {
  const [f, setF] = useState({ slug: "", name: "", kind: "society", limit_kva: "20", margin_kva: "1", pf: "0.95" });
  useEffect(() => { if (site) setF({ slug: site.slug, name: site.name, kind: site.kind, limit_kva: String(site.limit_va / 1000), margin_kva: String(site.safety_margin_va / 1000), pf: String(site.power_factor) }); }, [site]);
  const save = useSave(site ? `/admin/sites/${site.id}` : "/admin/sites", site ? "PATCH" : "POST");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const usable = (+f.limit_kva - +f.margin_kva) * +f.pf;
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-base font-semibold">{site ? "Site" : "Add your first site"}</h2>
      <form className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...(site ? {} : { slug: f.slug }), name: f.name, kind: f.kind, limit_va: Math.round(+f.limit_kva * 1000), safety_margin_va: Math.round(+f.margin_kva * 1000), power_factor: +f.pf }); }}>
        <Field label="Name"><input className="input" required value={f.name} onChange={set("name")} /></Field>
        {!site && <Field label="Short name" hint="Used in MQTT topics. Letters, numbers and dashes."><input className="input num" required pattern="[a-z0-9-]+" value={f.slug} onChange={set("slug")} /></Field>}
        <Field label="Type"><select className="input" value={f.kind} onChange={set("kind")}><option value="society">Housing society / RWA</option><option value="charging_point">E-rickshaw charging point</option><option value="campus">Campus building</option></select></Field>
        <Field label="Site limit (kVA)" hint="Sanctioned load, or the breaker / sub-board rating."><input className="input num" type="number" step="0.1" min="0.1" required value={f.limit_kva} onChange={set("limit_kva")} /></Field>
        <Field label="Safety margin (kVA)" hint="Kept free at all times."><input className="input num" type="number" step="0.1" min="0" required value={f.margin_kva} onChange={set("margin_kva")} /></Field>
        <Field label="Power factor" hint="Used to convert the kVA limit to kW."><input className="input num" type="number" step="0.01" min="0.5" max="1" required value={f.pf} onChange={set("pf")} /></Field>
        <div className="flex items-center gap-4 sm:col-span-2"><Button loading={save.isPending}>{site ? "Save changes" : "Create site"}</Button><Saved m={save} />
          {Number.isFinite(usable) && <span className="text-sm text-muted">Usable for load: <span className="num text-ink">{usable.toFixed(2)} kW</span></span>}</div>
      </form>
    </Card>
  );
}

function DevicesTab({ site }: { site?: Site }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["devices"], queryFn: () => api<Devices>("/admin/devices"), refetchInterval: 10_000 });
  const [f, setF] = useState({ name: "", topic: "", kind: "tasmota", max_w: "1500" });
  const [meter, setMeter] = useState({ name: "Main supply meter", topic: "" });
  const pair = useMutation({ mutationFn: () => api("/admin/plugs", { method: "POST", body: { site_id: site!.id, name: f.name, topic: f.topic, kind: f.kind, max_w: +f.max_w } }), onSuccess: () => { setF({ name: "", topic: "", kind: "tasmota", max_w: "1500" }); qc.invalidateQueries({ queryKey: ["devices"] }); } });
  const addMeter = useMutation({ mutationFn: () => api("/admin/meters", { method: "POST", body: { site_id: site!.id, ...meter } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }) });
  const remove = useMutation({ mutationFn: (id: number) => api(`/admin/plugs/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }) });
  if (!site) return <NoSite />;
  if (q.isLoading) return <Skeleton className="h-64 !rounded-xl" />;
  if (q.error || !q.data) return <Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card>;
  const d = q.data;
  return (
    <div className="grid gap-4">
      {d.unpaired.length > 0 && (
        <Card><CardHead title="Seen on the broker, not paired yet" hint="Click one to fill in the form below." />
          <ul className="flex flex-wrap gap-2 px-4 pt-3 pb-4 sm:px-6">{d.unpaired.map((u) => <li key={u.name}><button onClick={() => setF({ ...f, topic: u.name, name: f.name || u.name })} className="rounded-lg border border-amber/50 bg-amber-wash px-3 py-2 text-left text-sm text-amber-ink"><span className="num">{u.name}</span><span className="ml-2 text-xs opacity-80">{ago(u.last_seen)}</span></button></li>)}</ul></Card>
      )}
      <Card>
        <CardHead title="Smart plugs and chargers" hint="Tasmota plugs are paired by their MQTT topic; OCPP chargers by their charge point ID." />
        {d.plugs.length ? <div className="mt-2 overflow-x-auto"><table className="data min-w-[640px]"><thead><tr><th>Name</th><th>Topic / ID</th><th>Type</th><th className="!text-right">Max</th><th>Status</th><th>Last seen</th><th /></tr></thead>
          <tbody>{d.plugs.map((p) => <tr key={p.id}><td className="font-medium">{p.name}</td><td className="num">{p.topic}</td><td className="uppercase text-xs">{p.kind}</td><td className="num text-right">{p.max_w} W</td><td><span className="flex items-center gap-1.5"><Pill tone={p.online ? "done" : "info"}>{p.online ? "online" : "offline"}</Pill>{p.source === "SIMULATED" && <DataLabel kind="SIMULATED" />}</span></td><td className="text-muted">{ago(p.last_seen)}</td>
            <td className="text-right"><button aria-label={`Remove ${p.name}`} onClick={() => confirm(`Remove ${p.name}?`) && remove.mutate(p.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-danger-wash hover:text-danger-ink"><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
          : <EmptyState icon={Radio} title="No plugs paired" body="Power up a Tasmota plug on the site's MQTT broker. It appears above within a minute; then pair it here." />}
        {remove.error && <p className="px-6 pb-2 text-sm text-danger-ink">{(remove.error as Error).message}</p>}
        <form className="rule grid gap-4 p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-[1.2fr_1.2fr_0.8fr_0.7fr_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); pair.mutate(); }}>
          <Field label="Name"><input className="input" required placeholder="Bay 3 – e-rickshaw" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="MQTT topic / charge point ID"><input className="input num" required placeholder="tasmota_9F3A21" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value.trim() })} /></Field>
          <Field label="Type"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="tasmota">Tasmota plug</option><option value="ocpp">OCPP 1.6J</option></select></Field>
          <Field label="Max W"><input className="input num" type="number" min="50" required value={f.max_w} onChange={(e) => setF({ ...f, max_w: e.target.value })} /></Field>
          <Button loading={pair.isPending}><Plus size={16} />Pair plug</Button>
          {pair.error && <p className="text-sm text-danger-ink sm:col-span-2 lg:col-span-5">{(pair.error as Error).message}</p>}
        </form>
      </Card>
      <Card>
        <CardHead title="Meters" hint="The site's supply meter. It publishes JSON with a signed power value (negative means export)." />
        {d.meters.length ? <ul className="px-4 pt-2 pb-2 sm:px-6">{d.meters.map((m) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-0"><span className="font-medium">{m.name}</span><span className="num text-sm">{m.topic}</span><span className="text-sm text-muted">last reading {ago(m.last_seen)}</span></li>)}</ul> : null}
        <form className="rule grid gap-4 p-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end sm:p-6" onSubmit={(e) => { e.preventDefault(); addMeter.mutate(); }}>
          <Field label="Name"><input className="input" required value={meter.name} onChange={(e) => setMeter({ ...meter, name: e.target.value })} /></Field>
          <Field label="MQTT topic"><input className="input num" required placeholder={`voltix/${site.slug}/meter`} value={meter.topic} onChange={(e) => setMeter({ ...meter, topic: e.target.value.trim() })} /></Field>
          <Button variant="secondary" loading={addMeter.isPending}><Plus size={16} />Add meter</Button>
          {addMeter.error && <p className="text-sm text-danger-ink sm:col-span-3">{(addMeter.error as Error).message}</p>}
        </form>
      </Card>
    </div>
  );
}

function TariffTab({ site }: { site: Site }) {
  const [t, setT] = useState(site.tariff);
  const save = useSave(`/admin/sites/${site.id}`);
  const setW = (i: number, k: string, v: string | number) => setT({ ...t, windows: t.windows.map((w, j) => (j === i ? { ...w, [k]: v } : w)) });
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-base font-semibold">Time-of-Day tariff</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Enter the windows from your DISCOM&apos;s current tariff order. Times are IST. Money is stored in whole paise.</p>
      {(t.name ?? "").includes("placeholder") && <div className="mt-4 max-w-2xl"><Banner tone="amber">These are placeholder values shaped like the DERC ToD schedule. Confirm them against the current order before relying on cost figures.</Banner></div>}
      <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Tariff name"><input className="input" value={t.name ?? ""} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
        <Field label="Base energy charge (paise per kWh)" hint={`= ₹${(t.base_paise_per_kwh / 100).toFixed(2)} per kWh`}><input className="input num" type="number" min="0" value={t.base_paise_per_kwh} onChange={(e) => setT({ ...t, base_paise_per_kwh: Math.round(+e.target.value) })} /></Field>
      </div>
      <div className="mt-6 max-w-2xl">
        <div className="eyebrow mb-2">Windows</div>
        {t.windows.map((w, i) => (
          <div key={i} className="mb-3 grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Field label="Label"><select className="input" value={w.label} onChange={(e) => setW(i, "label", e.target.value)}><option value="off-peak">Off-peak</option><option value="peak">Peak</option><option value="solar">Solar hours</option></select></Field>
            <Field label="From"><input className="input num" type="time" value={w.start} onChange={(e) => setW(i, "start", e.target.value)} /></Field>
            <Field label="To"><input className="input num" type="time" value={w.end} onChange={(e) => setW(i, "end", e.target.value)} /></Field>
            <Field label="× base rate"><input className="input num" type="number" step="0.01" min="0" value={w.multiplier} onChange={(e) => setW(i, "multiplier", +e.target.value)} /></Field>
            <button aria-label="Remove window" onClick={() => setT({ ...t, windows: t.windows.filter((_, j) => j !== i) })} className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-danger-wash hover:text-danger-ink"><Trash2 size={16} /></button>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setT({ ...t, windows: [...t.windows, { label: "off-peak", start: "00:00", end: "06:00", multiplier: 0.8 }] })}><Plus size={15} />Add window</Button>
      </div>
      <div className="mt-6 flex items-center gap-4"><Button onClick={() => save.mutate({ tariff: t })} loading={save.isPending}>Save tariff</Button><Saved m={save} /></div>
    </Card>
  );
}

function TransformerTab({ site }: { site: Site }) {
  const tr = site.transformer as Record<string, number | undefined>;
  const [f, setF] = useState({ rated_kva: String(tr.rated_kva ?? 100), homes: String(tr.homes ?? 120), cost: String((tr.cost_paise ?? 25000000) / 100), life: String(tr.normal_life_h ?? 180000) });
  const save = useSave(`/admin/sites/${site.id}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card className="p-4 sm:p-6">
      <h2 className="text-base font-semibold">Transformer for the neighbourhood twin</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Thermal constants are the IEC 60076-7 values for ONAN distribution transformers. Sources for every number are in <span className="num">docs/sources.md</span>.</p>
      <form className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ transformer: { ...site.transformer, rated_kva: +f.rated_kva, homes: Math.round(+f.homes), cost_paise: Math.round(+f.cost * 100), normal_life_h: +f.life } }); }}>
        <Field label="Rating (kVA)"><input className="input num" type="number" min="10" required value={f.rated_kva} onChange={set("rated_kva")} /></Field>
        <Field label="Homes on this transformer"><input className="input num" type="number" min="1" required value={f.homes} onChange={set("homes")} /></Field>
        <Field label="Replacement cost (₹)"><input className="input num" type="number" min="0" required value={f.cost} onChange={set("cost")} /></Field>
        <Field label="Normal insulation life (hours)"><input className="input num" type="number" min="1" required value={f.life} onChange={set("life")} /></Field>
        <div className="flex items-center gap-4 sm:col-span-2"><Button loading={save.isPending}>Save transformer</Button><Saved m={save} /></div>
      </form>
      <dl className="mt-6 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {[["Top-oil rise", "55 K"], ["Hot-spot gradient", "23 K"], ["Loss ratio R", "5"], ["Oil exponent x", "0.8"], ["Winding exponent y", "1.6"], ["k11 / k21 / k22", "1.0 / 1.0 / 2.0"], ["Oil time constant", "180 min"], ["Winding time constant", "4 min"]].map(([k, v]) => <div key={k} className="border-t border-line pt-2"><dt className="text-xs text-muted">{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
    </Card>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-users"], queryFn: () => api<UserRow[]>("/admin/users") });
  const role = useMutation({ mutationFn: (v: { id: number; role: string }) => api(`/admin/users/${v.id}`, { method: "PATCH", body: { role: v.role } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }) });
  if (q.isLoading) return <Skeleton className="h-64 !rounded-xl" />;
  if (q.error) return <Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card>;
  return (
    <Card>
      <CardHead title="People and consent" hint="Consent is recorded with its timestamp before a user's first session." />
      {q.data?.length ? <div className="mt-2 overflow-x-auto"><table className="data min-w-[680px]"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Consent given</th><th className="!text-right">Sessions</th><th className="!text-right">Overrides</th></tr></thead>
        <tbody>{q.data.map((u) => <tr key={u.id}><td className="font-medium">{u.name}</td><td className="text-muted">{u.email}</td>
          <td><select aria-label={`Role for ${u.name}`} className="h-9 rounded-lg border border-line-strong bg-panel px-2 text-sm" value={u.role} onChange={(e) => role.mutate({ id: u.id, role: e.target.value })}><option value="user">User</option><option value="operator">Operator</option><option value="admin">Admin</option></select></td>
          <td className="num">{u.consent_at ? dateTime(u.consent_at) : <span className="font-sans text-muted">Not yet</span>}</td><td className="num text-right">{u.sessions}</td><td className="num text-right">{u.overrides}</td></tr>)}</tbody></table></div>
        : <EmptyState icon={Users} title="No users yet" body="People appear here after their first sign-in." />}
    </Card>
  );
}
