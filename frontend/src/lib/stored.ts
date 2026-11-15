"use client";

import { useSyncExternalStore } from "react";

const EVENT = "voltix-store";
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

/** A localStorage value that is safe during server rendering and stays in sync across tabs. */
export function useStored(key: string, fallback: string): string {
  return useSyncExternalStore(
    subscribe,
    () => {
      try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
    },
    () => fallback,
  );
}
export function setStored(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

const subscribeTheme = (cb: () => void) => {
  window.addEventListener("voltix-theme", cb);
  return () => window.removeEventListener("voltix-theme", cb);
};
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
}
