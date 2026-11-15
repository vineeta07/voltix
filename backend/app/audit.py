"""Append-only, hash-chained audit log.

hash_n = sha256(prev_hash | ts | kind | canonical_json(payload))
Changing or deleting any row breaks every hash after it; /api/audit/verify recomputes the chain.
"""

import hashlib
import json
import threading
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEntry, utcnow

GENESIS = "0" * 64
_lock = threading.Lock()


def canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def entry_hash(prev_hash: str, ts: datetime, kind: str, payload_json: str) -> str:
    msg = f"{prev_hash}|{ts.isoformat()}|{kind}|{payload_json}".encode()
    return hashlib.sha256(msg).hexdigest()


def append(db: Session, kind: str, payload: dict) -> AuditEntry:
    """Add an entry. The caller commits."""
    with _lock:
        db.flush()
        last = db.scalars(select(AuditEntry).order_by(AuditEntry.id.desc()).limit(1)).first()
        prev = last.hash if last else GENESIS
        ts = utcnow().replace(microsecond=0)
        body = canonical(payload)
        e = AuditEntry(ts=ts, kind=kind, payload=body, prev_hash=prev,
                       hash=entry_hash(prev, ts, kind, body))
        db.add(e)
        db.flush()
        return e


def verify(db: Session) -> dict:
    prev = GENESIS
    count = 0
    for e in db.scalars(select(AuditEntry).order_by(AuditEntry.id)):
        count += 1
        if e.prev_hash != prev or e.hash != entry_hash(prev, e.ts, e.kind, e.payload):
            return {"ok": False, "entries": count, "broken_at": e.id, "head": prev}
        prev = e.hash
    return {"ok": True, "entries": count, "broken_at": None, "head": prev}
