"use client";

import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowUp, Lock, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Banner, Card, EmptyState, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/auth";
import { useSite } from "@/lib/site";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };
const STARTERS = ["How did last night go?", "Is anything close to the limit right now?", "Which sessions were overridden this week?", "कल रात कितनी बिजली सोलर से आई?"];
const TOOL: Record<string, string> = { get_site_status: "Live site", get_night_report: "Night report", list_sessions: "Sessions", list_alerts: "Alerts" };

/** Renders the answer's markdown links to app screens; everything else is plain text. */
function Answer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(\/app\/[a-z/-]+\))/g);
  return (
    <p className="leading-relaxed whitespace-pre-line">
      {parts.map((p, i) => {
        const m = p.match(/^\[([^\]]+)\]\((\/app\/[a-z/-]+)\)$/);
        return m ? <Link key={i} href={m[2]} className="font-medium text-teal-ink underline underline-offset-2">{m[1]}</Link> : <span key={i}>{p.replaceAll("**", "")}</span>;
      })}
    </p>
  );
}

export default function AssistantPage() {
  const cfg = useConfig();
  const { site } = useSite();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const ask = useMutation({
    mutationFn: (question: string) => api<{ answer: string; tools_used: string[] }>("/assistant/ask", { method: "POST", body: { question, site_id: site!.id, history: msgs.map(({ role, content }) => ({ role, content })) } }),
    onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.answer, tools: r.tools_used }]),
  });
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, ask.isPending]);
  const send = (text: string) => {
    const t = text.trim();
    if (!t || ask.isPending || !site) return;
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setQ("");
    ask.mutate(t);
  };

  if (cfg.data && !cfg.data.assistant) {
    return (<><PageHeader title="Ask VOLTIX" /><Card><EmptyState icon={MessageSquareText} title="The assistant is switched off" body="It appears when an API key is set on the server. Nothing else in VOLTIX depends on it." /></Card></>);
  }
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ask VOLTIX" lead="Ask about this site in English or Hindi. Answers use numbers from your reports only." />
      <Banner><Lock size={16} className="mt-0.5 shrink-0" /><span>Read-only. The assistant can look at site status, the night report, sessions and alerts. It cannot create, change or cancel anything, and it has no part in scheduling.</span></Banner>
      <div className="mt-4 space-y-4" aria-live="polite">
        {!msgs.length && (
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="card px-4 py-3 text-left text-sm transition-colors duration-150 hover:border-teal">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={clsx("rise flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={clsx("max-w-[88%] rounded-xl px-4 py-3 text-[15px]", m.role === "user" ? "bg-ink text-paper" : "card")}>
              {m.role === "user" ? <p className="whitespace-pre-line">{m.content}</p> : <Answer text={m.content} />}
              {!!m.tools?.length && <p className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2 text-xs text-muted">Read from:{[...new Set(m.tools)].map((t) => <span key={t} className="num rounded border border-line-strong px-1.5">{TOOL[t] ?? t}</span>)}</p>}
            </div>
          </div>
        ))}
        {ask.isPending && <div className="card inline-flex gap-1.5 px-4 py-4" aria-label="Thinking">{[0, 1, 2].map((i) => <span key={i} className="skeleton h-2 w-2 !rounded-full" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>}
        {ask.error && <Banner tone="danger">{(ask.error as Error).message}</Banner>}
        <div ref={end} />
      </div>
      <form className="sticky bottom-20 mt-6 lg:bottom-6" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <div className="card flex items-end gap-2 p-2">
          <textarea aria-label="Your question" rows={1} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about load, sessions, alerts or last night…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(q); } }} className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base outline-none" />
          <button aria-label="Send" disabled={!q.trim() || ask.isPending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink text-paper transition-opacity disabled:opacity-40"><ArrowUp size={18} /></button>
        </div>
      </form>
    </div>
  );
}
