"""Sign-in and roles (admin, operator, user).

Tokens are HMAC-signed and issued by this API after either a Google sign-in
(the ID token is verified with Google) or, only when VOLTIX_DEV_LOGIN=1, a
development login.
"""

import base64
import hashlib
import hmac
import time

import httpx
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

ROLES = ("user", "operator", "admin")
TTL_S = 14 * 24 * 3600


def _sign(body: str) -> str:
    mac = hmac.new(get_settings().secret_key.encode(), body.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def make_token(user_id: int, ttl_s: int = TTL_S) -> str:
    body = f"{user_id}.{int(time.time()) + ttl_s}"
    return f"{body}.{_sign(body)}"


def read_token(token: str) -> int | None:
    try:
        uid, exp, sig = token.split(".")
        if not hmac.compare_digest(sig, _sign(f"{uid}.{exp}")) or int(exp) < time.time():
            return None
        return int(uid)
    except (ValueError, AttributeError):
        return None


def role_for(email: str, requested: str | None = None) -> str:
    s = get_settings()
    listed = lambda csv: email.lower() in {e.strip().lower() for e in csv.split(",") if e}  # noqa: E731
    if listed(s.admin_emails):
        return "admin"
    if listed(s.operator_emails):
        return "operator"
    if s.dev_login and requested in ROLES:
        return requested
    return "user"


def upsert_user(db: Session, email: str, name: str, role: str | None = None) -> User:
    user = db.scalars(select(User).where(User.email == email.lower())).first()
    if not user:
        user = User(email=email.lower(), name=name or email.split("@")[0],
                    role=role_for(email, role))
        db.add(user)
    elif role and get_settings().dev_login and role in ROLES:
        user.role = role_for(email, role)
    db.commit()
    return user


def verify_google(credential: str) -> dict:
    cid = get_settings().google_client_id
    if not cid:
        raise HTTPException(503, "Google sign-in is not configured")
    r = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential},
                  timeout=8.0)
    if r.status_code != 200:
        raise HTTPException(401, "Google did not accept this sign-in")
    info = r.json()
    if info.get("aud") != cid or info.get("email_verified") not in ("true", True):
        raise HTTPException(401, "This sign-in was not issued for VOLTIX")
    return info


def current_user(authorization: str | None = Header(default=None),
                 db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to continue")
    uid = read_token(authorization[7:])
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "Your session has expired. Sign in again.")
    return user


def require(*roles: str):
    def dep(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "You do not have access to this")
        return user

    return dep


operator = require("operator", "admin")
admin = require("admin")
