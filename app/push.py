"""Optional Web Push (VAPID).

``pywebpush`` is an optional dependency: without it ``supported`` is False, the
subscribe route says so, and in-app notifications keep working unchanged.
"""

from __future__ import annotations

import base64
import ipaddress
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional
from urllib.parse import urlparse

from .config import Config
from .db import Database, utcnow
from .errors import WalkhomeError
from .timeutil import Clock, local_date, get_tz

log = logging.getLogger(__name__)

try:  # optional dependency
    from pywebpush import webpush
    from py_vapid import Vapid
    from cryptography.hazmat.primitives import serialization

    HAVE_WEBPUSH = True
except Exception:  # noqa: BLE001
    HAVE_WEBPUSH = False

Sender = Callable[[dict, str], None]
Runner = Callable[..., None]


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class PushService:
    def __init__(
        self,
        db: Database,
        cfg: Config,
        clock: Clock,
        sender: Optional[Sender] = None,
        runner: Optional[Runner] = None,
    ) -> None:
        self.db = db
        self.cfg = cfg
        self.clock = clock
        self._sender = sender
        self._vapid: Any = None
        self._public_key: Optional[str] = None
        self._tried = False
        self._pool: Optional[ThreadPoolExecutor] = None
        self._runner = runner or self._run_in_thread

    # -- keys --------------------------------------------------------------

    @property
    def supported(self) -> bool:
        return self._sender is not None or (HAVE_WEBPUSH and self.public_key is not None)

    @property
    def public_key(self) -> Optional[str]:
        if self._public_key is None and not self._tried:
            self._tried = True
            self.ensure_keys()
        return self._public_key

    def ensure_keys(self) -> None:
        """Load ``data/vapid.json``, generating a keypair on first start."""
        if not HAVE_WEBPUSH:
            return
        path = self.cfg.get_vapid_path()
        try:
            if path.exists():
                data = json.loads(path.read_text())
            else:
                vapid = Vapid()
                vapid.generate_keys()
                public = vapid.public_key.public_bytes(
                    serialization.Encoding.X962,
                    serialization.PublicFormat.UncompressedPoint,
                )
                data = {
                    "public_key": _b64url(public),
                    "private_pem": vapid.private_pem().decode("ascii"),
                    "created_utc": utcnow(),
                }
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data, indent=1))
                try:
                    os.chmod(path, 0o600)
                except OSError:
                    pass
            self._vapid = Vapid.from_pem(data["private_pem"].encode("ascii"))
            self._public_key = data["public_key"]
        except Exception:  # noqa: BLE001 - push must never take the app down
            log.exception("could not load/generate VAPID keys; push disabled")
            self._vapid = None
            self._public_key = None

    # -- subscriptions -----------------------------------------------------

    @staticmethod
    def validate_endpoint(endpoint: str) -> None:
        parsed = urlparse(endpoint)
        host = parsed.hostname or ""
        bad = parsed.scheme != "https" or not host or host == "localhost"
        if not bad:
            try:
                ip = ipaddress.ip_address(host)
                bad = ip.is_private or ip.is_loopback or ip.is_link_local
            except ValueError:
                pass
        if bad:
            raise WalkhomeError("invalid push endpoint", 400, "bad_endpoint")

    def subscribe(self, user_id: int, endpoint: str, p256dh: str, auth: str) -> None:
        if not self.supported:
            raise WalkhomeError("web push is not available on this server", 400,
                                "push_unsupported")
        self.validate_endpoint(endpoint)
        self.db.execute(
            "INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth, created_utc) "
            "VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET "
            "user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth",
            (user_id, endpoint, p256dh, auth, utcnow()),
        )

    def unsubscribe(self, user_id: int, endpoint: Optional[str] = None) -> int:
        if endpoint:
            cur = self.db.execute(
                "DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?",
                (user_id, endpoint),
            )
        else:
            cur = self.db.execute(
                "DELETE FROM push_subscriptions WHERE user_id=?", (user_id,)
            )
        return cur.rowcount

    def is_subscribed(self, user_id: int) -> bool:
        return self.db.query_one(
            "SELECT 1 FROM push_subscriptions WHERE user_id=? LIMIT 1", (user_id,)
        ) is not None

    # -- sending -----------------------------------------------------------

    def _day(self) -> str:
        return local_date(self.clock(), get_tz(self.cfg.tz_name)).isoformat()

    def _take_quota(self, user_id: int) -> bool:
        with self.db.transaction():
            row = self.db.query_one(
                "SELECT sent FROM push_quota WHERE user_id=? AND day=?", (user_id, self._day())
            )
            sent = row["sent"] if row else 0
            if sent >= self.cfg.push_daily_quota:
                return False
            self.db.execute(
                "INSERT INTO push_quota(user_id, day, sent) VALUES(?,?,1) "
                "ON CONFLICT(user_id, day) DO UPDATE SET sent = sent + 1",
                (user_id, self._day()),
            )
        return True

    def send(self, user_id: int, payload: dict) -> None:
        """Queue a push for every device of the user (non blocking)."""
        if not self.is_subscribed(user_id):
            return
        self._runner(self.deliver, user_id, payload)

    def deliver(self, user_id: int, payload: dict) -> int:
        """Synchronous delivery with the daily quota. Returns devices reached."""
        if not self.supported:
            return 0
        subs = self.db.query(
            "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?", (user_id,)
        )
        if not subs or not self._take_quota(user_id):
            return 0
        body = json.dumps(payload, ensure_ascii=False)
        reached = 0
        for sub in subs:
            info = {"endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
            try:
                (self._sender or self._webpush)(info, body)
                reached += 1
            except Exception as exc:  # noqa: BLE001
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if status in (404, 410):
                    self.db.execute(
                        "DELETE FROM push_subscriptions WHERE endpoint=?", (sub["endpoint"],)
                    )
                else:
                    log.warning("push to %s failed: %s", sub["endpoint"][:40], exc)
        return reached

    def _webpush(self, info: dict, body: str) -> None:
        webpush(
            subscription_info=info,
            data=body,
            vapid_private_key=self._vapid,
            vapid_claims={"sub": self.cfg.vapid_subject},
            ttl=3600,
            timeout=10,
        )

    def _run_in_thread(self, fn: Callable[..., Any], *args: Any) -> None:
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")
        fut = self._pool.submit(fn, *args)
        fut.add_done_callback(
            lambda f: f.exception() and log.warning("push job failed: %s", f.exception())
        )

    def close(self) -> None:
        if self._pool:
            self._pool.shutdown(wait=False)
