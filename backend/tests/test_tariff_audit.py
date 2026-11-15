from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app import audit
from app.db import Base
from app.tariff import DEFAULT_TARIFF, cost_paise, next_cheap_start, price_profile, rate_at


def utc(h, m=0):  # IST = UTC + 5:30
    return datetime(2026, 6, 1, h, m)


def test_rate_windows_in_ist():
    assert rate_at(DEFAULT_TARIFF, utc(0, 0)).label == "off-peak"  # 05:30 IST
    assert rate_at(DEFAULT_TARIFF, utc(0, 0)).paise_per_kwh == 360
    assert rate_at(DEFAULT_TARIFF, utc(9, 0)).paise_per_kwh == 540  # 14:30 IST peak
    assert rate_at(DEFAULT_TARIFF, utc(6, 0)).paise_per_kwh == 450  # 11:30 IST normal
    assert rate_at(DEFAULT_TARIFF, utc(18, 45)).label == "peak"  # 00:15 IST, wraps midnight
    assert rate_at(DEFAULT_TARIFF, utc(19, 30)).label == "normal"  # 01:00 IST, end exclusive


def test_cost_is_integer_paise():
    assert cost_paise(1000, 450) == 450
    assert cost_paise(1234, 360) == 444
    assert isinstance(cost_paise(1, 1), int)


def test_price_profile_and_cheap_start():
    prof = price_profile(DEFAULT_TARIFF, utc(12, 30), 96, 15)  # from 18:00 IST
    assert len(prof) == 96 and min(prof) == 360 and max(prof) == 540
    cheap = next_cheap_start(DEFAULT_TARIFF, utc(12, 30))
    assert cheap == datetime(2026, 6, 1, 22, 30)  # 04:00 IST next morning
    assert next_cheap_start(DEFAULT_TARIFF, utc(0, 0)) == utc(0, 0)


def make_db():
    eng = create_engine("sqlite://")
    Base.metadata.create_all(eng)
    return Session(eng)


def test_audit_chain_verifies_and_detects_tampering():
    db = make_db()
    for i in range(5):
        audit.append(db, "command", {"plug": "p1", "on": bool(i % 2), "n": i})
    db.commit()
    v = audit.verify(db)
    assert v["ok"] and v["entries"] == 5

    db.execute(text("UPDATE audit_log SET payload = :p WHERE id = 3"), {"p": '{"n":99}'})
    db.commit()
    db.expire_all()
    v = audit.verify(db)
    assert not v["ok"] and v["broken_at"] == 3


def test_audit_detects_deleted_row():
    db = make_db()
    for i in range(4):
        audit.append(db, "plan", {"n": i})
    db.commit()
    db.execute(text("DELETE FROM audit_log WHERE id = 2"))
    db.commit()
    db.expire_all()
    assert audit.verify(db)["broken_at"] == 3
