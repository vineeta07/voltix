"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, token, type Config, type Me } from "./api";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => (token.get() ? await api<Me>("/me") : null),
    retry: false,
    staleTime: 60_000,
  });
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => api<Config>("/config"), staleTime: 300_000 });
}

export function useSignOut() {
  const qc = useQueryClient();
  return () => {
    token.clear();
    qc.clear();
    window.location.href = "/";
  };
}
