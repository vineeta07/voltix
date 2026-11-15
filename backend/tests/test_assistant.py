"""The assistant is read-only: it cannot reach any write path."""

import ast
import inspect
from types import SimpleNamespace

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app import assistant
from app.db import Base
from app.models import AuditEntry, ChargeSession, Plan, Plug, Site
from app.tariff import DEFAULT_TARIFF


def make():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    db = Session(eng)
    site = Site(slug="t", name="T", limit_va=5000, tariff=DEFAULT_TARIFF)
    db.add(site)
    db.flush()
    db.add(Plug(site_id=site.id, name="Bay 1", topic="p1", is_on=False))
    db.commit()
    return db, site


def counts(db):
    return [db.scalar(select(func.count()).select_from(t))
            for t in (ChargeSession, Plan, AuditEntry)] + \
        [db.scalars(select(Plug)).first().is_on]


def test_write_tools_are_refused():
    db, site = make()
    before = counts(db)
    for name in ("create_session", "override_session", "set_plug", "replan", "edit_site",
                 "cancel_session", "pair_plug"):
        out = assistant.run_tool(db, site, name, {"plug_id": 1, "on": True})
        assert "error" in out and "read-only" in out["error"]
    assert counts(db) == before


def test_every_offered_tool_is_read_only():
    db, site = make()
    before = counts(db)
    for tool in assistant.READ_TOOLS:
        out = assistant.run_tool(db, site, tool["name"], {})
        assert "error" not in out and out["source_screen"].startswith("/app/")
    assert not db.dirty and not db.new
    assert counts(db) == before
    names = {t["name"] for t in assistant.READ_TOOLS}
    assert all(n.startswith(("get_", "list_")) for n in names)


def test_module_has_no_path_to_commands_or_scheduler():
    tree = ast.parse(inspect.getsource(assistant))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            imported |= {a.name for a in node.names} | {node.module or ""}
        elif isinstance(node, ast.Import):
            imported |= {a.name for a in node.names}
    assert not imported & {"commands", "scheduler", "audit", "ingest", "httpx", "requests"}
    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    assert not called & {"add", "commit", "delete", "merge", "flush", "set_plug", "replan",
                         "override", "tick"}


class FakeClient:
    """Stands in for the LLM: first asks for a write tool, then answers."""

    def __init__(self):
        self.calls = 0
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))
        self.seen_results = []

    def create(self, **kw):
        self.calls += 1
        assert {t["name"] for t in kw["tools"]} == assistant.READ_TOOL_NAMES
        if self.calls == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                SimpleNamespace(type="tool_use", id="a", name="set_plug", input={"on": True}),
                SimpleNamespace(type="tool_use", id="b", name="get_site_status", input={})])
        self.seen_results = kw["messages"][-1]["content"]
        return SimpleNamespace(stop_reason="end_turn",
                               content=[SimpleNamespace(type="text", text="The limit is 4.8 kW.")])


def test_ask_loop_refuses_a_write_call_from_the_model():
    db, site = make()
    before = counts(db)
    fake = FakeClient()
    out = assistant.ask(db, site, "switch bay 1 on", client=fake)
    assert out["answer"] == "The limit is 4.8 kW."
    assert fake.seen_results[0]["is_error"] is True
    assert fake.seen_results[1]["is_error"] is False
    assert counts(db) == before


def test_endpoint_hides_itself_without_a_key():
    from fastapi.testclient import TestClient

    from app.main import app
    c = TestClient(app)
    assert c.get("/api/config").json()["assistant"] is False
