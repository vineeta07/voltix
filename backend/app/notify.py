"""Alerts for the operator and messages for users (Telegram when configured)."""

import httpx
from sqlalchemy.orm import Session

from .config import get_settings
from .hub import hub
from .models import Alert, User


def alert(db: Session, site_id: int, kind: str, message: str, level: str = "warning",
          session_id: int | None = None, dedupe: bool = True) -> Alert | None:
    if dedupe:
        q = db.query(Alert).filter_by(site_id=site_id, kind=kind, resolved=False,
                                      session_id=session_id)
        if q.first():
            return None
    a = Alert(site_id=site_id, kind=kind, message=message, level=level, session_id=session_id)
    db.add(a)
    db.flush()
    hub.publish(site_id, {"type": "alert", "id": a.id, "kind": kind, "level": level,
                          "message": message})
    return a


def telegram(user: User | None, text: str) -> bool:
    token = get_settings().telegram_bot_token
    if not token or not user or not user.telegram_chat_id:
        return False
    try:
        r = httpx.post(f"https://api.telegram.org/bot{token}/sendMessage", timeout=5.0,
                       json={"chat_id": user.telegram_chat_id, "text": text})
        return r.status_code == 200
    except Exception as e:
        print(f"[telegram] send failed: {e}")
        return False
