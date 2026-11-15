"use client";

import clsx from "clsx";
import { AlertTriangle, Moon, Sun, type LucideIcon } from "lucide-react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Source } from "@/lib/api";

/* ---------- Logo (the supplied brand files, never recoloured) ---------- */
export function Logo({ height = 28, markOnly = false }: { height?: number; markOnly?: boolean }) {
  if (markOnly) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/voltix-mark.svg" alt="VOLTIX" width={height} height={height} className="dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/voltix-mark-dark.svg" alt="VOLTIX" width={height} height={height} className="hidden dark:block" />
      </>
    );
  }
  const w = Math.round((height * 264) / 64);
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/voltix-logo-light.svg" alt="VOLTIX" width={w} height={height} className="dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/voltix-logo-dark.svg" alt="VOLTIX" width={w} height={height} className="hidden dark:block" />
    </>
  );
}

/* ---------- Button ---------- */
type BtnProps = {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "teal";
  size?: "sm" | "md" | "lg";
  href?: string;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = "primary", size = "md", href, loading, className, children, disabled, ...rest }: BtnProps) {
  const cls = clsx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,transform,opacity] duration-150 active:translate-y-px",
    "disabled:opacity-50 disabled:pointer-events-none",
    size === "sm" && "h-9 px-3 text-sm",
    size === "md" && "h-11 px-4 text-sm",
    size === "lg" && "h-14 px-6 text-base",
    variant === "primary" && "bg-ink text-paper hover:opacity-90",
    variant === "teal" && "bg-teal-ink text-paper hover:opacity-90",
    variant === "secondary" && "border border-line-strong bg-panel text-ink hover:border-muted",
    variant === "ghost" && "text-ink hover:bg-teal-wash",
    variant === "danger" && "border border-danger/40 text-danger-ink hover:bg-danger-wash",
    className,
  );
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("card", className)} {...rest}>{children}</div>;
}
export function CardHead({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-6 sm:pt-5">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/* ---------- DataLabel: MEASURED / MODELLED / FORECAST / SIMULATED ---------- */
const LABEL_STYLE: Record<string, string> = {
  MEASURED: "border-teal/40 text-teal-ink bg-teal-wash",
  MODELLED: "border-line-strong text-muted",
  FORECAST: "border-amber/50 text-amber-ink bg-amber-wash",
  SIMULATED: "border-danger/40 text-danger-ink bg-danger-wash",
  MIXED: "border-line-strong text-muted",
};
const LABEL_HELP: Record<string, string> = {
  MEASURED: "Read from a real meter or plug",
  MODELLED: "Calculated by a model, not measured",
  FORECAST: "A prediction of the future",
  SIMULATED: "Produced by the built-in simulator, not by real devices",
  MIXED: "Part measured, part simulated",
};
export function DataLabel({ kind }: { kind: Source }) {
  return (
    <span title={LABEL_HELP[kind]} className={clsx("inline-flex h-5 items-center rounded border px-1.5 font-mono text-[11px] tracking-wider", LABEL_STYLE[kind])}>
      {kind}
    </span>
  );
}

/* ---------- LiveBadge ---------- */
export function LiveBadge({ live = true, label }: { live?: boolean; label?: string }) {
  return (
    <span className={clsx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2 font-mono text-[11px] tracking-wider",
      live ? "border-safe/40 text-safe-ink" : "border-line-strong text-muted")}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", live ? "live-dot bg-safe text-safe" : "bg-grey")} />
      {label ?? (live ? "LIVE" : "OFFLINE")}
    </span>
  );
}

/* ---------- CountUp: numbers ease to their new value without moving the layout ---------- */
export function CountUp({ value, digits = 0, className }: { value: number; digits?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    const fmt = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    if (reduce) {
      el.textContent = fmt(value);
      prev.current = value;
      return;
    }
    const c = animate(prev.current, value, { duration: 0.6, ease: "easeOut", onUpdate: (v) => (el.textContent = fmt(v)) });
    prev.current = value;
    return () => c.stop();
  }, [value, digits, reduce, inView]);
  return <span ref={ref} className={className}>{value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>;
}

/* ---------- StatCard ---------- */
export function StatCard({ label, value, unit, digits = 0, source, hint, tone, icon: Icon, text }: {
  label: string; value?: number | null; unit?: string; digits?: number; source?: Source; hint?: string;
  tone?: "safe" | "danger" | "amber"; icon?: LucideIcon; text?: string;
}) {
  return (
    <Card className="flex min-h-[124px] flex-col justify-between p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm text-muted">
          {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden />}
          {label}
        </span>
        {source && <DataLabel kind={source} />}
      </div>
      <div>
        <div className={clsx("num mt-3 text-[28px] leading-none font-medium sm:text-[32px]",
          tone === "safe" && "text-safe-ink", tone === "danger" && "text-danger-ink", tone === "amber" && "text-amber-ink")}>
          {text ?? (value == null ? "–" : <CountUp value={value} digits={digits} />)}
          {unit && value != null && <span className="ml-1.5 text-sm font-normal text-muted">{unit}</span>}
        </div>
        <p className="mt-2 min-h-[18px] text-xs text-muted">{hint}</p>
      </div>
    </Card>
  );
}

/* ---------- Empty, error, loading ---------- */
export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-line-strong text-muted">
        <Icon size={22} strokeWidth={1.5} aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <EmptyState icon={AlertTriangle} title="This did not load" body={msg}
      action={retry && <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>} />
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[124px] !rounded-xl" />)}
      </div>
      <Skeleton className="mt-4 h-[380px] !rounded-xl" />
    </div>
  );
}

/* ---------- Reveal: fade and slide once, when scrolled into view ---------- */
export function Reveal({ children, delay = 0, className, y = 14 }: { children: React.ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.45, delay, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

/* ---------- Theme toggle ---------- */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const flip = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("voltix.theme", next ? "dark" : "light"); } catch {}
    setDark(next);
    window.dispatchEvent(new Event("voltix-theme"));
  };
  return (
    <button onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={clsx("flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-teal-wash hover:text-ink", className)}>
      {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  );
}
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains("dark"));
    read();
    window.addEventListener("voltix-theme", read);
    return () => window.removeEventListener("voltix-theme", read);
  }, []);
  return dark;
}

/* ---------- Page header, pills, fields ---------- */
export function PageHeader({ title, lead, right }: { title: string; lead?: string; right?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[32px] leading-tight font-medium sm:text-[40px]">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-sm text-muted sm:text-base">{lead}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}
const STATUS: Record<string, string> = {
  waiting: "bg-amber-wash text-amber-ink border-amber/50",
  paused: "bg-amber-wash text-amber-ink border-amber/50",
  charging: "bg-teal-wash text-teal-ink border-teal/40",
  done: "text-safe-ink border-safe/40",
  cancelled: "text-muted border-line-strong",
  critical: "bg-danger-wash text-danger-ink border-danger/40",
  warning: "bg-amber-wash text-amber-ink border-amber/50",
  info: "text-muted border-line-strong",
};
export function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={clsx("inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium capitalize", STATUS[tone] ?? STATUS.info)}>{children}</span>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export function Banner({ tone = "info", children }: { tone?: "info" | "danger" | "amber"; children: React.ReactNode }) {
  return (
    <div role="status" className={clsx("rise flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
      tone === "danger" && "border-danger/40 bg-danger-wash text-danger-ink",
      tone === "amber" && "border-amber/50 bg-amber-wash text-amber-ink",
      tone === "info" && "border-line-strong text-muted")}>
      {children}
    </div>
  );
}
