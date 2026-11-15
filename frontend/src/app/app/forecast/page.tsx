"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { ForecastChart } from "@/components/charts";
import { Banner, Card, CardHead, DataLabel, EmptyState, ErrorState, PageHeader, PageSkeleton, StatCard } from "@/components/ui";
import { api, type Source } from "@/lib/api";
import { useSite } from "@/lib/site";

type Fc = {
  method: string; history_source: Source; capacity_w: number[];
  metrics: { ok: boolean; reason?: string; rows?: number; method?: string; holdout_rows?: number; train_rows?: number; pinball_p50_w?: number; pinball_p90_w?: number; coverage_p50?: number; coverage_p90?: number; mae_w?: number; mean_load_w?: number };
  recent: { ts: string; nonev_w: number; surplus_w: number }[]; points: { ts: string; p50_w: number; p90_w: number; solar_w: number }[];
};
const METHOD: Record<string, string> = { lightgbm: "LightGBM quantile regression", profile: "Time-of-day profile (not enough history for LightGBM yet)", flat: "Flat estimate (no history yet)" };

export default function ForecastPage() {
  const { site } = useSite();
  const q = useQuery({ queryKey: ["forecast", site?.id], queryFn: () => api<Fc>(`/sites/${site!.id}/forecast`), enabled: !!site, refetchInterval: 300_000 });
  if (q.isLoading || !site) return (<><PageHeader title="Forecast" /><PageSkeleton /></>);
  if (q.error || !q.data) return (<><PageHeader title="Forecast" /><Card><ErrorState error={q.error} retry={() => q.refetch()} /></Card></>);
  const d = q.data, m = d.metrics;
  const cov = m.coverage_p90 != null ? m.coverage_p90 * 100 : null;
  return (
    <>
      <PageHeader title="Forecast" lead="The building's non-EV load for the next 24 hours. The scheduler plans against P90, so a normal bad day still fits under the limit." />
      {d.method !== "lightgbm" && <div className="mb-4"><Banner tone="amber">{METHOD[d.method]}. LightGBM takes over automatically after five days of meter history.</Banner></div>}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="P90 coverage" value={cov} digits={1} unit="%" hint="Target 90%. Share of held-out readings at or under P90." tone={cov != null && cov < 80 ? "danger" : cov != null ? "safe" : undefined} />
        <StatCard label="Pinball loss, P90" value={m.pinball_p90_w} digits={0} unit="W" hint="Lower is better" />
        <StatCard label="Pinball loss, P50" value={m.pinball_p50_w} digits={0} unit="W" hint="Lower is better" />
        <StatCard label="Typical error" value={m.mae_w} digits={0} unit="W" hint={m.mean_load_w ? `on a mean load of ${Math.round(m.mean_load_w)} W` : undefined} />
      </div>
      <Card className="mt-4">
        <CardHead title="Next 24 hours" hint={METHOD[d.method]} right={<><DataLabel kind={d.history_source} /><DataLabel kind="FORECAST" /></>} />
        <div className="px-2 pt-3 pb-3 sm:px-4">
          {d.recent.length ? <ForecastChart recent={d.recent} points={d.points} capacity={d.capacity_w} /> : <EmptyState icon={TrendingUp} title="No history to learn from yet" body="The forecast starts as soon as the meter has published for a few hours." />}
        </div>
      </Card>
      <Card className="mt-4 p-4 sm:p-6">
        <h2 className="text-base font-semibold">How this is scored</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          {m.ok ? `Day-ahead forecasts were made for each of the last two days using only earlier data, then compared with what the meter recorded (${m.holdout_rows} held-out readings, ${m.train_rows} for training).` : `Accuracy cannot be scored yet: ${m.reason}.`}{" "}
          Features: load one day and one week earlier, time of day, weekday and the Open-Meteo temperature forecast. The forecast informs the schedule; it never switches a plug.
        </p>
      </Card>
    </>
  );
}
