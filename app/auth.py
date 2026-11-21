"""Accounts: scrypt passwords, hashed session tokens, login throttling.

* Passwords are stored as ``scrypt$n$r$p$salt$hash`` (``hashlib.scrypt``).
* Session tokens are 32 random bytes; **only their SHA-256 is stored**, so a
  leaked database does not leak usable sessions.
* The same token is accepted as a cookie (``wh_session``) or ``Bearer``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import threading
import time
from datetime import timedelta
from typing import Callable, Dict, List, Optional, Tuple

from .config import Config
from .db import Database, utcnow
from .errors import (
    Conflict, Forbidden, TooManyRequests, Unauthorized, WalkhomeError,
)
from .timeutil import Clock, iso, parse_utc

COOKIE_NAME = "wh_session"
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,24}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 256

# Tunable so the test-suite does not spend seconds hashing.
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1


def hash_password(password: str, n: Optional[int] = None) -> str:
    n = n or SCRYPT_N
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=SCRYPT_R, p=SCRYPT_P, maxmem=128 * 1024 * 1024
    )
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"scrypt${n}${SCRYPT_R}${SCRYPT_P}${b64(salt)}${b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p),
            maxmem=128 * 1024 * 1024, dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class LoginLimiter:
    """N failures per window per (ip, username); success clears the counter."""

    def __init__(self, max_failures: int, window_s: float, now: Callable[[], float] = time.monotonic):
        self.max = max_failures
        self.window = window_s
        self.now = now
        self._fails: Dict[Tuple[str, str], List[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: Tuple[str, str]) -> List[float]:
        cutoff = self.now() - self.window
        kept = [t for t in self._fails.get(key, []) if t > cutoff]
        if kept:
            self._fails[key] = kept
        else:
            self._fails.pop(key, None)
        return kept

    def check(self, ip: str, username: str) -> None:
        key = (ip, username.lower())
        with self._lock:
            fails = self._prune(key)
            if len(fails) >= self.max:
                wait = int(self.window - (self.now() - fails[0])) + 1
                raise TooManyRequests("too many failed attempts, try again later", max(wait, 1))

    def failure(self, ip: str, username: str) -> None:
        key = (ip, username.lower())
        with self._lock:
            self._prune(key)
            self._fails.setdefault(key, []).append(self.now())

    def success(self, ip: str, username: str) -> None:
        with self._lock:
            self._fails.pop((ip, username.lower()), None)


PRIVATE_FIELDS = ("password_hash",)


def public_user_row(row) -> dict:
    """A users row without the secrets."""
    d = dict(row)
    for f in PRIVATE_FIELDS:
        d.pop(f, None)
    return d


class AuthService:
    def __init__(self, db: Database, cfg: Config, clock: Clock, limiter: Optional[LoginLimiter] = None):
        self.db = db
        self.cfg = cfg
        self.clock = clock
        self.limiter = limiter or LoginLimiter(cfg.login_max_failures, cfg.login_window_s)
        # Verified against when the username is unknown: equalises timing.
        self._dummy_hash = hash_password("walkhome-dummy-password")

    # -- validation --------------------------------------------------------

    @staticmethod
    def validate_password(password: str) -> None:
        if len(password) < MIN_PASSWORD:
            raise WalkhomeError(f"password must be at least {MIN_PASSWORD} characters", 400,
                                "weak_password")
        if len(password) > MAX_PASSWORD:
            raise WalkhomeError("password is too long", 400, "bad_password")

    @staticmethod
    def validate_username(username: str) -> str:
        if not USERNAME_RE.match(username or ""):
            raise WalkhomeError(
                "username must be 3-24 characters: letters, digits, '_', '.', '-'", 400,
                "bad_username")
        return username

    def user_by_username(self, username: str) -> Optional[dict]:
        row = self.db.query_one(
            "SELECT * FROM users WHERE username=? COLLATE NOCASE", (username,)
        )
        return dict(row) if row else None

    def user_by_id(self, user_id: int) -> Optional[dict]:
        row = self.db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
        return dict(row) if row else None

    def _has_admin(self) -> bool:
        return self.db.query_one(
            "SELECT 1 FROM users WHERE is_admin=1 AND archived=0 LIMIT 1") is not None

    # -- register / claim / login -----------------------------------------

    def register(
        self,
        username: str,
        password: str,
        journey_id: str,
        avatar: str = "🧝",
        color: str = "#8ecae6",
        display_name: Optional[str] = None,
        invite_code: Optional[str] = None,
    ) -> dict:
        mode = self.cfg.registration
        if mode == "invite":
            expected = self.cfg.invite_code
            if not expected or not hmac.compare_digest(
                (invite_code or "").encode(), expected.encode()
            ):
                raise Forbidden("a valid invite code is required", "invite_required")
        elif mode not in ("open",):
            raise Forbidden("registration is closed", "registration_closed")
        self.validate_username(username)
        self.validate_password(password)
        if not COLOR_RE.match(color or ""):
            raise WalkhomeError("color must be #rrggbb", 400, "bad_color")
        name = (display_name or username).strip()
        if not 1 <= len(name) <= 40:
            raise WalkhomeError("display name must be 1-40 characters", 400, "bad_display_name")
        pw = hash_password(password)
        with self.db.transaction():
            if self.user_by_username(username):
                raise Conflict("username already taken", "username_taken")
            is_admin = 0 if self._has_admin() else 1
            try:
                uid = self.db.insert(
                    "INSERT INTO users (display_name, username, password_hash, avatar, color, "
                    "journey_id, is_admin, units, created_utc) VALUES (?,?,?,?,?,?,?,?,?)",
                    (name, username, pw, avatar[:32], color, journey_id, is_admin,
                     self.cfg.units if self.cfg.units in ("km", "mi") else "km", utcnow()),
                )
            except Exception as exc:  # sqlite3.IntegrityError on display_name/username
                if "UNIQUE" in str(exc).upper():
                    raise Conflict("username already taken", "username_taken")
                raise
        return self.user_by_id(uid)  # type: ignore[return-value]

    def claim(self, username: str, password: str, ip: str = "-") -> dict:
        """First login of a pre-v2 walker: choose a password for the legacy account."""
        self.limiter.check(ip, username)
        self.validate_password(password)
        with self.db.transaction():
            user = self.user_by_username(username)
            if user is None or user["password_hash"] is not None:
                self.limiter.failure(ip, username)
                raise Forbidden("this account cannot be claimed", "not_claimable")
            is_admin = 1 if not self._has_admin() else user["is_admin"]
            self.db.execute(
                "UPDATE users SET password_hash=?, is_admin=? WHERE id=?",
                (hash_password(password), is_admin, user["id"]),
            )
        return self.user_by_id(user["id"])  # type: ignore[return-value]

    def login(self, username: str, password: str, ip: str = "-") -> dict:
        self.limiter.check(ip, username)
        user = self.user_by_username(username)
        stored = user["password_hash"] if user else None
        ok = verify_password(password, stored or self._dummy_hash)
        if user is None or not stored or not ok:
            if user is not None and not stored:
                raise Forbidden("this account has no password yet: claim it", "claim_required")
            self.limiter.failure(ip, username)
            raise Unauthorized("invalid username or password", "invalid_credentials")
        if user["archived"]:
            raise Forbidden("this account is archived", "account_archived")
        self.limiter.success(ip, username)
        return user

    def change_password(self, user_id: int, old: str, new: str,
                        keep_token: Optional[str] = None) -> None:
        user = self.user_by_id(user_id)
        if not user or not user["password_hash"] or not verify_password(old, user["password_hash"]):
            raise Forbidden("current password is wrong", "invalid_credentials")
        self.validate_password(new)
        self.db.execute("UPDATE users SET password_hash=? WHERE id=?", (hash_password(new), user_id))
        # Sign out every other device.
        if keep_token:
            self.db.execute(
                "DELETE FROM auth_tokens WHERE user_id=? AND token_hash!=?",
                (user_id, hash_token(keep_token)),
            )
        else:
            self.db.execute("DELETE FROM auth_tokens WHERE user_id=?", (user_id,))

    # -- sessions ----------------------------------------------------------

    def issue_token(self, user_id: int, user_agent: str = "") -> str:
        token = secrets.token_urlsafe(32)
        now = self.clock()
        self.db.insert(
            "INSERT INTO auth_tokens(user_id, token_hash, created_utc, last_used_utc, "
            "expires_utc, user_agent) VALUES(?,?,?,?,?,?)",
            (user_id, hash_token(token), iso(now), iso(now),
             iso(now + timedelta(days=self.cfg.session_days)), user_agent[:200]),
        )
        return token

    def authenticate(self, token: Optional[str]) -> Optional[dict]:
        """User for a token (sliding 90-day expiry), or None."""
        if not token:
            return None
        row = self.db.query_one(
            "SELECT t.id AS tid, t.expires_utc, t.last_used_utc, u.* FROM auth_tokens t "
            "JOIN users u ON u.id = t.user_id WHERE t.token_hash=?",
            (hash_token(token),),
        )
        if row is None:
            return None
        now = self.clock()
        expires = parse_utc(row["expires_utc"])
        if expires is None or expires <= now or row["archived"]:
            self.db.execute("DELETE FROM auth_tokens WHERE id=?", (row["tid"],))
            return None
        last = parse_utc(row["last_used_utc"])
        if last is None or (now - last) > timedelta(minutes=10):
            self.db.execute(
                "UPDATE auth_tokens SET last_used_utc=?, expires_utc=? WHERE id=?",
                (iso(now), iso(now + timedelta(days=self.cfg.session_days)), row["tid"]),
            )
            self.db.execute("UPDATE users SET last_seen_utc=? WHERE id=?", (iso(now), row["id"]))
        user = dict(row)
        for k in ("tid", "expires_utc", "last_used_utc"):
            user.pop(k, None)
        return user

    def revoke(self, token: Optional[str]) -> None:
        if token:
            self.db.execute("DELETE FROM auth_tokens WHERE token_hash=?", (hash_token(token),))

    def purge_expired(self) -> None:
        self.db.execute("DELETE FROM auth_tokens WHERE expires_utc <= ?", (iso(self.clock()),))
