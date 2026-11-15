"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useStored } from "./stored";

type SiteLite = { id: number; slug: string; name: string; kind: string; limit_va: number };

export function useSites() {
  return useQuery({ queryKey: ["sites"], queryFn: () => api<SiteLite[]>("/sites"), staleTime: 60_000 });
}
/** The site being viewed. One site today; the picker appears when there are more. */
export function useSite() {
  const q = useSites();
  const saved = Number(useStored("voltix.site", "0"));
  const site = q.data?.find((s) => s.id === saved) ?? q.data?.[0];
  return { site, sites: q.data ?? [], isLoading: q.isLoading, error: q.error };
}
