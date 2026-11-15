"""Database tables. Power in W / VA, energy in Wh, money in paise, time in UTC."""

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Site(Base):
    __tablename__ = "sites"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32), default="campus")  # society|charging_point|campus
    limit_va: Mapped[int] = mapped_column(Integer, default=20000)
    safety_margin_va: Mapped[int] = mapped_column(Integer, default=1000)
    power_factor: Mapped[float] = mapped_column(Float, default=0.95)
    latitude: Mapped[float] = mapped_column(Float, default=28.7501)
    longitude: Mapped[float] = mapped_column(Float, default=77.1177)
    tariff: Mapped[dict] = mapped_column(JSON, default=dict)
    transformer: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Meter(Base):
    __tablename__ = "meters"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    name: Mapped[str] = mapped_column(String(120))
    topic: Mapped[str] = mapped_column(String(200), unique=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Plug(Base):
    __tablename__ = "plugs"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    name: Mapped[str] = mapped_column(String(120))
    topic: Mapped[str] = mapped_column(String(200), unique=True)  # Tasmota topic or OCPP id
    kind: Mapped[str] = mapped_column(String(16), default="tasmota")  # tasmota|ocpp
    max_w: Mapped[int] = mapped_column(Integer, default=1500)
    is_on: Mapped[bool] = mapped_column(Boolean, default=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False)
    power_w: Mapped[float] = mapped_column(Float, default=0.0)
    total_wh: Mapped[float] = mapped_column(Float, default=0.0)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="measured")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")  # admin|operator|user
    telegram_chat_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consent_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    late_count: Mapped[int] = mapped_column(Integer, default=0)  # fairness memory
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChargeSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    plug_id: Mapped[int] = mapped_column(ForeignKey("plugs.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    vehicle_type: Mapped[str] = mapped_column(String(32))
    battery_pct: Mapped[int] = mapped_column(Integer)
    energy_needed_wh: Mapped[int] = mapped_column(Integer)
    power_w: Mapped[int] = mapped_column(Integer)
    interruptible: Mapped[bool] = mapped_column(Boolean, default=False)
    plugged_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    ready_by: Mapped[datetime] = mapped_column(DateTime)
    planned_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    planned_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    start_total_wh: Mapped[float | None] = mapped_column(Float, nullable=True)
    delivered_wh: Mapped[float] = mapped_column(Float, default=0.0)
    solar_wh: Mapped[float] = mapped_column(Float, default=0.0)
    cost_paise: Mapped[int] = mapped_column(Integer, default=0)
    # waiting | charging | paused | done | cancelled
    status: Mapped[str] = mapped_column(String(16), default="waiting")
    overridden: Mapped[bool] = mapped_column(Boolean, default=False)
    at_risk: Mapped[bool] = mapped_column(Boolean, default=False)
    proposed_ready_by: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    position_last: Mapped[bool] = mapped_column(Boolean, default=False)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    anomaly: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="measured")


class MeterReading(Base):
    __tablename__ = "meter_readings"
    ts: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    site_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    load_w: Mapped[float] = mapped_column(Float)  # import from the supply, >= 0
    export_w: Mapped[float] = mapped_column(Float, default=0.0)  # export to the supply, >= 0
    voltage: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="measured")


class PlugReading(Base):
    __tablename__ = "plug_readings"
    ts: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    plug_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    power_w: Mapped[float] = mapped_column(Float)
    total_wh: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(16), default="measured")


class Plan(Base):
    __tablename__ = "plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    slot_start: Mapped[datetime] = mapped_column(DateTime)
    reason: Mapped[str] = mapped_column(String(64), default="periodic")
    feasible: Mapped[bool] = mapped_column(Boolean, default=True)
    peak_w: Mapped[float] = mapped_column(Float, default=0.0)
    body: Mapped[dict] = mapped_column(JSON, default=dict)


class Override(Base):
    __tablename__ = "overrides"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    action: Mapped[str] = mapped_column(String(32))  # charge_now | stop
    reason: Mapped[str] = mapped_column(String(200), default="")


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    site_id: Mapped[int] = mapped_column(ForeignKey("sites.id"))
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    level: Mapped[str] = mapped_column(String(16), default="info")  # info|warning|critical
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
    session_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class ForecastPoint(Base):
    __tablename__ = "forecast_points"
    site_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, primary_key=True)
    p50_w: Mapped[float] = mapped_column(Float)
    p90_w: Mapped[float] = mapped_column(Float)
    solar_w: Mapped[float] = mapped_column(Float, default=0.0)
    method: Mapped[str] = mapped_column(String(32), default="profile")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditEntry(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String(32))  # plan|command|override|summary|config
    payload: Mapped[str] = mapped_column(Text)  # canonical JSON
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
