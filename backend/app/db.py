from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine(url: str):
    if url.startswith("sqlite"):
        kw: dict = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in url or url.rstrip("/") == "sqlite:":
            kw["poolclass"] = StaticPool
        return create_engine(url, **kw)
    return create_engine(url, pool_pre_ping=True)


engine = _make_engine(get_settings().database_url)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as db:
        yield db


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        _init_timescale()


def _init_timescale() -> None:
    """Hypertables + 1 min / 15 min continuous aggregates. Skipped if the
    extension is not installed, so plain Postgres still works."""
    stmts = [
        "CREATE EXTENSION IF NOT EXISTS timescaledb",
        "SELECT create_hypertable('meter_readings','ts', if_not_exists => TRUE, migrate_data => TRUE)",
        "SELECT create_hypertable('plug_readings','ts', if_not_exists => TRUE, migrate_data => TRUE)",
    ]
    for bucket, name in (("1 minute", "1m"), ("15 minutes", "15m")):
        stmts.append(
            f"""CREATE MATERIALIZED VIEW IF NOT EXISTS meter_{name}
            WITH (timescaledb.continuous) AS
            SELECT time_bucket('{bucket}', ts) AS bucket, site_id,
                   avg(load_w) AS load_w, avg(export_w) AS export_w, max(load_w) AS peak_w
            FROM meter_readings GROUP BY bucket, site_id WITH NO DATA"""
        )
        stmts.append(
            f"""CREATE MATERIALIZED VIEW IF NOT EXISTS plug_{name}
            WITH (timescaledb.continuous) AS
            SELECT time_bucket('{bucket}', ts) AS bucket, plug_id,
                   avg(power_w) AS power_w, max(total_wh) AS total_wh
            FROM plug_readings GROUP BY bucket, plug_id WITH NO DATA"""
        )
    for s in stmts:
        try:
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
                c.execute(text(s))
        except Exception as e:  # pragma: no cover - depends on the server
            print(f"[db] timescale step skipped: {str(e).splitlines()[0]}")
