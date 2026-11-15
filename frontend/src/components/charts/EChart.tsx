"use client";

import { BarChart, CustomChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { useIsDark } from "@/lib/stored";

echarts.use([LineChart, BarChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, MarkAreaComponent, SVGRenderer]);

import { palette, type Palette } from "./base";

/** Fixed-height chart, so live updates never shift the layout. */
export function EChart({ build, height = 320, label }: {
  build: (p: Palette) => Record<string, unknown>; height?: number; label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const dark = useIsDark();

  useEffect(() => {
    if (!el.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const c = echarts.init(el.current, undefined, { renderer: "svg" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    if (reduce) c.setOption({ animation: false });
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(build(palette(dark)), { notMerge: true, lazyUpdate: true });
  }, [build, dark]);

  return <div ref={el} role="img" aria-label={label} style={{ height }} className="w-full" />;
}
