"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, PlugZap, Settings2 } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Field, Logo, Skeleton, ThemeToggle } from "@/components/ui";
import { api, token, type Me, type Role } from "@/lib/api";
import { useConfig } from "@/lib/auth";

type Auth = { token: string; user: Me };
const ROLES: { role: Role; label: string; hint: string; icon: typeof Activity }[] = [
  { role: "user", label: "Driver / resident", hint: "Plug in and charge", icon: PlugZap },
  { role: "operator", label: "Facility manager", hint: "Run the site", icon: Activity },
  { role: "admin", label: "Admin", hint: "Set everything up", icon: Settings2 },
];
declare global { interface Window { google?: { accounts: { id: { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void } } } } }

function SignIn() {
  const cfg = useConfig();
  const qc = useQueryClient();
  const [role, setRole] = useState<Role>("operator");
  const [name, setName] = useState("");
  const gbtn = useRef<HTMLDivElement>(null);
  const finish = useCallback((a: Auth) => {
    token.set(a.token);
    qc.clear();
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/app") ? next : "/app";
  }, [qc]);
  const dev = useMutation({ mutationFn: () => api<Auth>("/auth/dev-login", { method: "POST", body: { email: `${(name || role).toLowerCase().replace(/[^a-z0-9]+/g, ".")}@dev.voltix.local`, name: name || ROLES.find((r) => r.role === role)!.label, role } }), onSuccess: finish });
  const google = useMutation({ mutationFn: (credential: string) => api<Auth>("/auth/google", { method: "POST", body: { credential } }), onSuccess: finish });
  const gid = cfg.data?.google_client_id;
  const initGoogle = useCallback(() => {
    if (!gid || !window.google || !gbtn.current) return;
    window.google.accounts.id.initialize({ client_id: gid, callback: (r: { credential: string }) => google.mutate(r.credential) });
    window.google.accounts.id.renderButton(gbtn.current, { theme: "outline", size: "large", width: 320, text: "continue_with" });
  }, [gid, google]);
  useEffect(() => { initGoogle(); }, [initGoogle]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between bg-[#0F2A3A] p-12 text-[#EEF3F2] lg:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <Link href="/"><img src="/brand/voltix-logo-dark.svg" alt="VOLTIX" width={132} height={32} /></Link>
        <div>
          <p className="font-display max-w-md text-[40px] leading-[1.1] font-medium">Tariffs tell every EV when power is cheap. Nobody tells them <em>not all at once.</em></p>
          <div className="mt-10 max-w-sm space-y-2.5" aria-hidden>
            {[[0, 46, 0.55], [18, 46, 0.8], [36, 46, 1]].map(([l, w, o], i) => <div key={i} className="h-3 rounded-full bg-white/10"><div className="h-3 rounded-full bg-[#1F9E89]" style={{ marginLeft: `${l}%`, width: `${w}%`, opacity: o }} /></div>)}
          </div>
        </div>
        <p className="font-mono text-xs tracking-wider text-white/50">MEASURED · MODELLED · FORECAST — ALWAYS LABELLED</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex h-16 items-center justify-between px-4 sm:px-8"><Link href="/" className="lg:invisible"><Logo height={26} /></Link><ThemeToggle /></div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-8">
          <div className="rise w-full max-w-sm">
            <h1 className="font-display text-[40px] leading-tight font-medium">Sign in</h1>
            <p className="mt-2 text-muted">Use your Google account. Your role decides what you see.</p>
            {cfg.isLoading ? <Skeleton className="mt-8 h-12" /> : cfg.error ? <div className="mt-8"><Banner tone="danger">{(cfg.error as Error).message}</Banner></div> : (
              <>
                {gid ? (<><Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={initGoogle} /><div ref={gbtn} className="mt-8 min-h-11" /></>)
                  : !cfg.data?.dev_login && <div className="mt-8"><Banner tone="amber">Google sign-in is not configured on this server yet. Set VOLTIX_GOOGLE_CLIENT_ID to enable it.</Banner></div>}
                {google.error && <div className="mt-4"><Banner tone="danger">{(google.error as Error).message}</Banner></div>}
                {cfg.data?.dev_login && (
                  <form className="mt-8" onSubmit={(e) => { e.preventDefault(); dev.mutate(); }}>
                    {gid && <div className="mb-6 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>}
                    <p className="eyebrow mb-3">Development sign-in · enabled on this server</p>
                    <div className="grid gap-2" role="radiogroup" aria-label="Role">
                      {ROLES.map((r) => (
                        <button type="button" role="radio" aria-checked={role === r.role} key={r.role} onClick={() => setRole(r.role)}
                          className={clsx("flex h-16 items-center gap-3 rounded-xl border px-4 text-left transition-colors duration-150", role === r.role ? "border-teal bg-teal-wash" : "border-line-strong hover:border-muted")}>
                          <r.icon size={20} strokeWidth={1.5} className={role === r.role ? "text-teal-ink" : "text-muted"} />
                          <span><span className="block text-sm font-medium">{r.label}</span><span className="block text-xs text-muted">{r.hint}</span></span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-4"><Field label="Your name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Vineeta" autoComplete="name" /></Field></div>
                    {dev.error && <div className="mt-4"><Banner tone="danger">{(dev.error as Error).message}</Banner></div>}
                    <Button size="lg" className="mt-5 w-full" loading={dev.isPending}>Continue</Button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return <Suspense><SignIn /></Suspense>;
}
