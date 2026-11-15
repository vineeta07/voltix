"""Edge agent fallback: cut the cloud link and charging continues."""

import importlib.util
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "edge_agent", Path(__file__).resolve().parents[2] / "edge" / "agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

NOW = datetime(2026, 11, 15, 18, 0, tzinfo=UTC)
z = lambda dt: dt.isoformat().replace("+00:00", "Z")  # noqa: E731


def plan(issued=NOW, **sessions):
    return {"site": "t", "issued_at": z(issued), "plugs": ["p1", "p2", "p3"],
            "sessions": [{"plug": k, "status": v[0], "start": z(v[1]), "overridden": False}
                         for k, v in sessions.items()]}


def test_no_plan_means_every_plug_is_on():
    assert agent.decide(None, NOW, ["p1", "p2"]) == {"p1": True, "p2": True}
    assert agent.decide({}, NOW, ["p1"]) == {"p1": True}


def test_follows_the_last_plan_while_offline():
    p = plan(p1=("waiting", NOW + timedelta(hours=2)), p2=("charging", NOW - timedelta(hours=1)))
    assert agent.decide(p, NOW) == {"p1": False, "p2": True, "p3": True}
    # two hours later, still offline, same saved plan: the waiting plug starts on time
    later = NOW + timedelta(hours=2, minutes=1)
    assert agent.decide(p, later) == {"p1": True, "p2": True, "p3": True}


def test_stale_plan_fails_open():
    p = plan(issued=NOW - timedelta(hours=30), p1=("waiting", NOW + timedelta(hours=2)))
    assert agent.decide(p, NOW)["p1"] is True


def test_override_and_unknown_plugs_are_on():
    p = plan(p1=("waiting", NOW + timedelta(hours=2)))
    p["sessions"][0]["overridden"] = True
    assert agent.decide(p, NOW, ["new-plug"]) == {"p1": True, "p2": True, "p3": True,
                                                  "new-plug": True}


def test_saved_plan_survives_a_restart(tmp_path):
    f = tmp_path / "last_plan.json"
    f.write_text(json.dumps(plan(p1=("waiting", NOW + timedelta(hours=1)))))
    assert agent.decide(agent.load(f), NOW)["p1"] is False
    assert agent.load(tmp_path / "missing.json") is None
    (tmp_path / "bad.json").write_text("{not json")
    assert agent.decide(agent.load(tmp_path / "bad.json"), NOW, ["p1"]) == {"p1": True}
