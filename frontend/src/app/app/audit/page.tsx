"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Card, CardHead, EmptyState, ErrorState, PageHeader, Pill, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";

type Entry = { id: number; ts: string; kind: string; payload: string; hash: string; prev_hash: string };
type Verify = { ok: boolean; entries: number; broken_at: number | null; head: string };
const TONE: Record<string, string> = { plan: "charging", command: "waiting", override: "critical", config: "info", summary: "info" };

function describe(e: Entry) {
  try {
    const p = JSON.parse(e.payload);
    if (e.kind === "command") return `${p.plug} switched ${p.on ? "ON" : "OFF"}${p.limit_w ? ` at ${p.limit_w} W` : ""} — ${p.reason}`;
    if (e.kind === "plan") return `Plan #${p.plan_id} (${p.reason}): ${Object.keys(p.sessions ?? {}).length} sessions, peak ${(p.peak_w / 1000).toFixed(1)} kW, ${p.feasible ? "all deadlines met" : "a deadline is at risk"}`;
    if (e.kind === "override") return `Session #${p.session_id}: user ${p.action.replaceAll("_", " ")}${p.reason ? ` — ${p.reason}` : ""}`;
    if (e.kind === "config") return `${p.event}${p.by ? ` by ${p.by}` : ""}${p.topic ? ` (${p.topic})` : ""}`;
    return e.payload;
  } catch { return e.payload; }
}

export default function AuditPage() {
  const list = useQuery({ queryKey: ["audit"], queryFn: () => api<Entry[]>("/audit?limit=200"), refetchInterval: 30_000 });
  const v = useQuery({ queryKey: ["audit-verify"], queryFn: () => api<Verify>("/audit/verify") });
  return (
    <>
      <PageHeader title="Audit log" lead="Every plan, plug command, override and config change, chained by SHA-256. Changing or deleting one entry breaks every hash after it."
        right={<Button variant="secondary" size="sm" onClick={() => v.refetch()} loading={v.isFetching}><RefreshCw size={15} />Verify chain</Button>} />
      <Card className="p-4 sm:p-6">
        {v.isLoading ? <Skeleton className="h-12" /> : v.data ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className={`flex items-center gap-2 text-xl font-medium ${v.data.ok ? "text-safe-ink" : "text-danger-ink"}`}>{v.data.ok ? <ShieldCheck size={22} strokeWidth={1.75} /> : <ShieldAlert size={22} strokeWidth={1.75} />}{v.data.ok ? "Chain intact" : `Chain broken at entry ${v.data.broken_at}`}</span>
            <span className="text-sm text-muted"><span className="num text-ink">{v.data.entries.toLocaleString("en-IN")}</span> entries checked</span>
            <span className="num min-w-0 truncate text-xs text-muted" title={v.data.head}>head {v.data.head}</span>
          </div>
        ) : <ErrorState error={v.error} retry={() => v.refetch()} />}
      </Card>
      <Card className="mt-4">
        <CardHead title="Latest entries" hint="Newest first" />
        {list.isLoading ? <div className="space-y-3 p-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          : list.error ? <ErrorState error={list.error} retry={() => list.refetch()} />
          : !list.data?.length ? <EmptyState icon={ScrollText} title="The log is empty" body="Entries are written the moment VOLTIX makes a plan or switches a plug." />
          : <div className="mt-2 overflow-x-auto"><table className="data min-w-[720px]">
              <thead><tr><th>#</th><th>Time (IST)</th><th>Kind</th><th>What happened</th><th>Hash</th></tr></thead>
              <tbody>{list.data.map((e) => (
                <tr key={e.id}><td className="num text-muted">{e.id}</td><td className="num whitespace-nowrap">{dateTime(e.ts)}</td><td><Pill tone={TONE[e.kind] ?? "info"}>{e.kind}</Pill></td><td className="max-w-[460px]">{describe(e)}</td><td className="num text-xs text-muted" title={e.hash}>{e.hash.slice(0, 12)}…</td></tr>
              ))}</tbody></table></div>}
      </Card>
    </>
  );
}
