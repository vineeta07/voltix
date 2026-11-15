"use client";

import clsx from "clsx";
import {
  Activity, BookOpen, CalendarClock, ChevronDown, Gauge, History, LogOut, MessageSquareText, Moon, Network,
  PlugZap, ScrollText, Settings2, ShieldCheck, TrendingUp, type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Banner, Logo, Skeleton, ThemeToggle } from "@/components/ui";
import type { Role } from "@/lib/api";
import { useConfig, useMe, useSignOut } from "@/lib/auth";
import { useSite } from "@/lib/site";
import { setStored } from "@/lib/stored";

type Item = { href: string; label: string; icon: LucideIcon; roles: Role[]; group: string; mobile?: boolean; needs?: "assistant" };
const NAV: Item[] = [
  { href: "/app/charge", label: "My charging", icon: PlugZap, roles: ["user", "operator", "admin"], group: "Charge", mobile: true },
  { href: "/app/history", label: "History", icon: History, roles: ["user", "operator", "admin"], group: "Charge", mobile: true },
  { href: "/app/live", label: "Live site", icon: Activity, roles: ["operator", "admin"], group: "Operate", mobile: true },
  { href: "/app/sessions", label: "Sessions", icon: CalendarClock, roles: ["operator", "admin"], group: "Operate" },
  { href: "/app/report", label: "Night report", icon: Moon, roles: ["operator", "admin"], group: "Operate", mobile: true },
  { href: "/app/forecast", label: "Forecast", icon: TrendingUp, roles: ["operator", "admin"], group: "Plan" },
  { href: "/app/twin", label: "Neighbourhood twin", icon: Network, roles: ["operator", "admin"], group: "Plan", mobile: true },
  { href: "/app/audit", label: "Audit log", icon: ShieldCheck, roles: ["operator", "admin"], group: "Trust" },
  { href: "/app/assistant", label: "Ask VOLTIX", icon: MessageSquareText, roles: ["operator", "admin"], group: "Trust", needs: "assistant" },
  { href: "/app/admin", label: "Admin", icon: Settings2, roles: ["admin"], group: "Set up" },
  { href: "/app/guide", label: "User guide", icon: BookOpen, roles: ["user", "operator", "admin"], group: "Help", mobile: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const me = useMe();
  const cfg = useConfig();
  const { site, sites } = useSite();
  const signOut = useSignOut();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!me.isLoading && !me.data) router.replace(`/signin?next=${encodeURIComponent(path)}`);
  }, [me.isLoading, me.data, router, path]);

  if (!me.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center" aria-busy="true">
        <div className="w-40"><Skeleton className="h-8" /></div>
      </div>
    );
  }
  const role = me.data.role;
  const items = NAV.filter((n) => n.roles.includes(role) && (n.needs !== "assistant" || cfg.data?.assistant));
  const groups = [...new Set(items.map((i) => i.group))];
  const mobile = items.filter((i) => i.mobile).slice(0, 5);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-panel lg:flex">
        <Link href="/" className="flex h-16 items-center px-5" aria-label="VOLTIX home"><Logo height={26} /></Link>
        <div className="mx-3 mb-2 rounded-lg border border-line px-3 py-2">
          <div className="eyebrow !text-[10px]">Site</div>
          {sites.length > 1 ? (
            <label className="relative block">
              <select aria-label="Site" className="w-full appearance-none bg-transparent pr-5 text-sm font-medium" value={site?.id}
                onChange={(e) => setStored("voltix.site", e.target.value)}>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute top-1 right-0 text-muted" />
            </label>
          ) : (
            <div className="truncate text-sm font-medium">{site?.name ?? "No site yet"}</div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {groups.map((g) => (
            <div key={g} className="mt-4 first:mt-2">
              <div className="eyebrow px-3 pb-1.5 !text-[10px]">{g}</div>
              {items.filter((i) => i.group === g).map((i) => (
                <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
                  className={clsx("relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                    active(i.href) ? "font-medium text-ink" : "text-muted hover:bg-teal-wash hover:text-ink")}>
                  {active(i.href) && (
                    <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-teal-wash" transition={{ duration: 0.2, ease: "easeOut" }}>
                      <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-teal" />
                    </motion.span>
                  )}
                  <i.icon size={17} strokeWidth={1.75} className="relative" aria-hidden />
                  <span className="relative">{i.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-medium text-paper">{(me.data.name || me.data.email)[0]?.toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me.data.name || me.data.email}</div>
              <div className="text-xs text-muted capitalize">{role}</div>
            </div>
            <ThemeToggle />
            <button onClick={signOut} aria-label="Sign out" className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-teal-wash hover:text-ink"><LogOut size={17} strokeWidth={1.75} /></button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        {/* Top bar (mobile) */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur-sm lg:hidden">
          <Link href="/" aria-label="VOLTIX home"><Logo height={22} /></Link>
          <div className="flex items-center">
            <ThemeToggle />
            <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label="Account and more"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-ink text-sm font-medium text-paper">{(me.data.name || me.data.email)[0]?.toUpperCase()}</button>
          </div>
          {menu && (
            <div className="rise card absolute top-[52px] right-3 w-64 p-2">
              <div className="px-3 py-2"><div className="truncate text-sm font-medium">{me.data.name || me.data.email}</div><div className="text-xs text-muted capitalize">{role} · {site?.name}</div></div>
              <div className="rule my-1" />
              {items.filter((i) => !mobile.includes(i)).map((i) => (
                <Link key={i.href} href={i.href} onClick={() => setMenu(false)} className="flex h-11 items-center gap-3 rounded-lg px-3 text-sm hover:bg-teal-wash"><i.icon size={17} strokeWidth={1.75} />{i.label}</Link>
              ))}
              <button onClick={signOut} className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-teal-wash"><LogOut size={17} strokeWidth={1.75} />Sign out</button>
            </div>
          )}
        </header>

        {cfg.data?.simulate && (
          <div className="border-b border-danger/30 bg-danger-wash px-4 py-2 text-center text-xs text-danger-ink sm:text-sm">
            <Gauge size={14} className="mr-1.5 inline -translate-y-px" aria-hidden />
            Simulator is on. Meter and plug values on this site are <b>SIMULATED</b>, not measured.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
          <motion.div key={path} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
            {!site && sites.length === 0 && role !== "user" && path !== "/app/admin" && path !== "/app/guide" ? (
              <Banner><ScrollText size={16} className="mt-0.5 shrink-0" />No site is set up yet. An admin can add one under Admin.</Banner>
            ) : children}
          </motion.div>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-panel pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${mobile.length}, minmax(0, 1fr))` }}>
        {mobile.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}
            className={clsx("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px]", active(i.href) ? "font-medium text-teal-ink" : "text-muted")}>
            {active(i.href) && <motion.span layoutId="tab-active" className="absolute top-0 h-[3px] w-10 rounded-b-full bg-teal" transition={{ duration: 0.2 }} />}
            <i.icon size={20} strokeWidth={1.75} aria-hidden />
            <span className="max-w-full truncate px-1">{i.label.replace("Neighbourhood ", "").replace("My ", "")}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
