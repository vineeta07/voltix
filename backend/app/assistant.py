"""Ask VOLTIX: a read-only assistant for operators.

One direct LLM API call with function calling. No agent framework.

Safety model
  * The model can only call the functions in READ_TOOLS. Each one reads the
    database and returns JSON; none of them writes, schedules or commands.
  * Any other tool name is refused in code (`run_tool`), whatever the model asks.
  * The assistant has no HTTP client and no credentials for the write API.
  * It sits outside the control path: nothing here is imported by the
    scheduler, the control loop or the command bus.
"""

import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import control, reports
from .config import get_settings
from .models import Alert, ChargeSession, Site, utcnow

MAX_TURNS = 6

SYSTEM = """You are Ask VOLTIX, a read-only assistant for the facility manager of an EV \
charging site. VOLTIX schedules EV charging so a building stays under its electrical limit.

Rules:
- Every number you state must come from a tool result in this conversation. If a tool did not \
return it, say you do not have it. Never estimate or invent a figure.
- Say whether each figure is MEASURED, MODELLED, FORECAST or SIMULATED, using the source the \
tool reports.
- You cannot create, change or cancel sessions, schedules, plug commands or settings. If asked \
to, say so and point to the screen where the person can do it themselves.
- Reply in the language of the question: English or Hindi. Keep answers short and plain, with \
units on every number and times in IST.
- End with the source screen for the figures you used, as a markdown link, for example \
[Night report](/app/report)."""

READ_TOOLS: list[dict] = [
    {"name": "get_site_status",
     "description": "Current measured load, EV load, solar surplus, the site limit, active "
                    "sessions and plug states. Use for questions about right now.",
     "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "get_night_report",
     "description": "The report for one night (noon to noon IST): peak vs limit, ready-by "
                    "times met, kWh delivered and from solar, cost, comparison with a ToD timer, "
                    "overrides and audit-chain status. Omit `night` for the latest finished night.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         "night": {"type": "string", "description": "Date the night starts, YYYY-MM-DD"}}}},
    {"name": "list_sessions",
     "description": "Recent charging sessions with status, planned and actual times, energy, "
                    "cost and anomaly flags.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         "status": {"type": "string",
                    "enum": ["waiting", "charging", "paused", "done", "cancelled"]},
         "limit": {"type": "integer", "description": "How many to return, at most 50"}}}},
    {"name": "list_alerts",
     "description": "Operator alerts: overloads, deadlines at risk, charger anomalies.",
     "input_schema": {"type": "object", "additionalProperties": False, "properties": {
         "open_only": {"type": "boolean"}}}},
]
READ_TOOL_NAMES = frozenset(t["name"] for t in READ_TOOLS)


def enabled() -> bool:
    return bool(get_settings().llm_api_key)


def run_tool(db: Session, site: Site, name: str, args: dict) -> dict:
    """Execute one read-only tool. Anything not on the allowlist is refused."""
    if name not in READ_TOOL_NAMES:
        return {"error": f"'{name}' is not available. This assistant is read-only."}
    iso = lambda t: t.isoformat() + "Z" if t else None  # noqa: E731
    if name == "get_site_status":
        m = control.measured_now(db, site)
        sessions = control.active_sessions(db, site.id)
        return {
            "source_screen": "/app/live", "site": site.name,
            "limit_w": round(site.limit_va * site.power_factor),
            "measured": ({"load_w": round(m["load_w"]), "ev_w": round(m["ev_w"]),
                          "solar_surplus_w": round(m["surplus_w"]), "at": iso(m["ts"]),
                          "source": m["source"].upper()} if m else None),
            "active_sessions": [reports.session_row(s) for s in sessions],
        }
    if name == "get_night_report":
        try:
            day = date.fromisoformat(args["night"]) if args.get("night") else \
                reports.default_night(utcnow())
        except ValueError:
            return {"error": "night must be a date like 2026-11-14"}
        r = reports.night_report(db, site, day)
        for k in ("series", "session_rows"):
            r.pop(k, None)
        if r.get("tod_timer"):
            r["tod_timer"].pop("total_w", None)
        return {"source_screen": "/app/report", **r}
    if name == "list_sessions":
        q = select(ChargeSession).where(ChargeSession.site_id == site.id)
        if args.get("status"):
            q = q.where(ChargeSession.status == args["status"])
        lim = max(1, min(50, int(args.get("limit") or 20)))
        rows = db.scalars(q.order_by(ChargeSession.id.desc()).limit(lim))
        return {"source_screen": "/app/sessions",
                "sessions": [reports.session_row(s) for s in rows]}
    aq = select(Alert).where(Alert.site_id == site.id)
    if args.get("open_only"):
        aq = aq.where(Alert.resolved.is_(False))
    return {"source_screen": "/app/live", "alerts": [
        {"at": iso(a.ts), "level": a.level, "kind": a.kind, "message": a.message,
         "resolved": a.resolved} for a in db.scalars(aq.order_by(Alert.id.desc()).limit(30))]}


def ask(db: Session, site: Site, question: str, history: list[dict] | None = None,
        client=None) -> dict:
    """Answer one question. Returns {"answer", "tools_used"}."""
    import anthropic

    cfg = get_settings()
    client = client or anthropic.Anthropic(api_key=cfg.llm_api_key)
    messages: list[dict] = [*(history or []), {"role": "user", "content": question}]
    used: list[str] = []
    response = None
    for _ in range(MAX_TURNS):
        response = client.beta.messages.create(
            model=cfg.llm_model, max_tokens=8000, system=SYSTEM, tools=READ_TOOLS,
            messages=messages, output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default")
        if response.stop_reason == "refusal":
            return {"answer": "I can't help with that request.", "tools_used": used}
        if response.stop_reason != "tool_use":
            break
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            args = block.input if isinstance(block.input, dict) else {}
            out = run_tool(db, site, block.name, args)
            used.append(block.name)
            results.append({"type": "tool_result", "tool_use_id": block.id,
                            "content": json.dumps(out, default=str),
                            "is_error": "error" in out})
        messages.append({"role": "user", "content": results})
    text = "".join(b.text for b in (response.content if response else []) if b.type == "text")
    return {"answer": text.strip() or "I could not produce an answer. Please try again.",
            "tools_used": used}


def night_summary(db: Session, site: Site, day: date, client=None) -> str:
    q = (f"Write a 5-line plain-language summary of the night of {day.isoformat()} for the "
         f"facility manager and the DISCOM. One line each: peak against the limit, ready-by "
         f"times met, energy and solar, cost against the baselines, and anything that needs "
         f"attention. Plain text, no markdown, no closing link.")
    return ask(db, site, q, client=client)["answer"]
