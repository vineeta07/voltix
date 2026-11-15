"use client";

import clsx from "clsx";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Logo, ThemeToggle } from "@/components/ui";
import { useMe } from "@/lib/auth";

const LINKS = [["/#how", "How it works"], ["/#proof", "The snapback"], ["/#who", "Who it's for"], ["/impact", "Impact"], ["/guide", "User guide"]];

export function PublicNav() {
  const me = useMe();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={clsx("sticky top-0 z-40 transition-[background-color,border-color] duration-200", scrolled || open ? "border-b border-line bg-paper/95 backdrop-blur-sm" : "border-b border-transparent")}>
      <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="VOLTIX home"><Logo height={28} /></Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Site">
          {LINKS.map(([h, l]) => <Link key={h} href={h} className="text-sm text-muted transition-colors hover:text-ink">{l}</Link>)}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button href={me.data ? "/app" : "/signin"} size="sm" className="ml-1 hidden sm:inline-flex">{me.data ? "Open app" : "Sign in"}</Button>
          <button className="flex h-10 w-10 items-center justify-center md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {open && (
        <nav className="rise border-t border-line px-4 pt-2 pb-4 md:hidden" aria-label="Site">
          {LINKS.map(([h, l]) => <Link key={h} href={h} onClick={() => setOpen(false)} className="flex h-12 items-center border-b border-line text-base">{l}</Link>)}
          <Button href={me.data ? "/app" : "/signin"} className="mt-4 w-full">{me.data ? "Open app" : "Sign in"}</Button>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div>
          <Logo height={26} />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">The traffic signal for EV charging on a neighbourhood transformer. Built at Delhi Technological University for the Schneider Electric Yuva Yodha Energy Tech Hackathon 2026, Challenge 03.</p>
        </div>
        <div><p className="eyebrow mb-3">Product</p><ul className="space-y-2 text-sm">{[["/#how", "How it works"], ["/impact", "Live impact"], ["/guide", "User guide"], ["/signin", "Sign in"]].map(([h, l]) => <li key={h}><Link href={h} className="text-muted hover:text-ink">{l}</Link></li>)}</ul></div>
        <div><p className="eyebrow mb-3">Principles</p><ul className="space-y-2 text-sm text-muted"><li>Measured, modelled and forecast are always labelled</li><li>No AI in the control path</li><li>Fail open: you can always charge</li></ul></div>
      </div>
      <div className="border-t border-line"><div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6 lg:px-8"><span>© 2026 VOLTIX · MIT licence</span><span className="num">All times IST</span></div></div>
    </footer>
  );
}
