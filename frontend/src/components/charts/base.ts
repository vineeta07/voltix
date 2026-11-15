export type Palette = ReturnType<typeof palette>;
export function palette(dark: boolean) {
  return {
    ink: dark ? "#EEF3F2" : "#0F2A3A",
    muted: dark ? "#A9BCC4" : "#5A6B74",
    line: dark ? "rgba(255,255,255,0.12)" : "rgba(15,42,58,0.12)",
    panel: dark ? "#173A4D" : "#FFFFFF",
    teal: "#1F9E89",
    amber: "#F2A93B",
    danger: "#D64545",
    safe: "#2E9D5B",
    grey: dark ? "#7F949D" : "#9AA6AB",
    greyDark: dark ? "#B8C6CC" : "#5A6B74",
  };
}

export function baseOption(p: Palette) {
  const axis = {
    axisLine: { lineStyle: { color: p.line } },
    axisTick: { show: false },
    axisLabel: { color: p.muted, fontFamily: "IBM Plex Mono, monospace", fontSize: 11, hideOverlap: true },
    splitLine: { lineStyle: { color: p.line } },
  };
  return {
    animationDuration: 500,
    animationDurationUpdate: 300,
    animationEasing: "cubicOut" as const,
    textStyle: { fontFamily: "IBM Plex Sans, sans-serif", color: p.ink },
    grid: { left: 8, right: 12, top: 48, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis" as const,
      backgroundColor: p.panel,
      borderColor: p.line,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: p.ink, fontSize: 12, fontFamily: "IBM Plex Sans, sans-serif" },
      axisPointer: { lineStyle: { color: p.muted, type: "dashed" as const } },
      extraCssText: "box-shadow: 0 6px 20px -12px rgba(15,42,58,.35); border-radius: 8px;",
    },
    legend: {
      top: 0, left: 0, itemWidth: 14, itemHeight: 3, icon: "roundRect", itemGap: 16,
      textStyle: { color: p.muted, fontSize: 12 },
    },
    axis,
  };
}
