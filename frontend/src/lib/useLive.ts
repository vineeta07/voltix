"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/** Opens the site WebSocket and refreshes the given queries when the site changes.
 *  Polling stays on as the fallback, so the page still updates if the socket cannot open. */
export function useLiveSocket(siteId: number | undefined, keys: string[]) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const keyStr = keys.join("|");
  useEffect(() => {
    if (!siteId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const base =
      process.env.NEXT_PUBLIC_WS_URL ??
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8000`;
    const refresh = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        keyStr.split("|").forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      }, 800);
    };
    const open = () => {
      try {
        ws = new WebSocket(`${base}/ws/sites/${siteId}`);
      } catch {
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onmessage = refresh;
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(open, 5000);
      };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      if (pending) clearTimeout(pending);
      ws?.close();
    };
  }, [siteId, keyStr, qc]);
  return connected;
}
