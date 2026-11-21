"""In-app notification center (table + WebSocket ``notify``) with optional push."""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, Iterable, List, Optional

from .db import Database, utcnow

KINDS = (
    "pack", "rank_overtake", "weekly_podium", "streak_risk", "quest", "milestone", "system",
)

Publish = Callable[[int, str, dict], None]


def row_to_notification(row: Any) -> dict:
    data = None
    if row["data_json"]:
        try:
            data = json.loads(row["data_json"])
        except ValueError:
            data = None
    out = {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "body": row["body"],
        "icon": row["icon"],
        "created_utc": row["created_utc"],
        "read": row["read_utc"] is not None,
    }
    if data is not None:
        out["data"] = data
    return out


class Notifier:
    def __init__(self, db: Database, publish: Optional[Publish] = None, push: Any = None):
        self.db = db
        self.publish = publish or (lambda uid, t, d: None)
        self.push = push

    def create(
        self,
        user_id: int,
        kind: str,
        title: str,
        body: str = "",
        icon: str = "",
        data: Optional[Dict[str, Any]] = None,
        push: bool = True,
    ) -> dict:
        nid = self.db.insert(
            "INSERT INTO notifications(user_id, kind, title, body, icon, data_json, created_utc) "
            "VALUES(?,?,?,?,?,?,?)",
            (user_id, kind, title, body, icon,
             json.dumps(data, ensure_ascii=False) if data else None, utcnow()),
        )
        row = self.db.query_one("SELECT * FROM notifications WHERE id=?", (nid,))
        note = row_to_notification(row)
        self.publish(user_id, "notify", note)
        if push and self.push is not None:
            url = (data or {}).get("url", "/")
            self.push.send(
                user_id,
                {"title": title, "body": body, "tag": kind, "data": {"url": url, "kind": kind}},
            )
        return note

    def list(self, user_id: int, limit: int = 30) -> List[dict]:
        rows = self.db.query(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        )
        return [row_to_notification(r) for r in rows]

    def unread_count(self, user_id: int) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_utc IS NULL",
            (user_id,),
        )
        return int(row["n"])

    def mark_read(
        self, user_id: int, ids: Optional[Iterable[int]] = None, all_: bool = False
    ) -> int:
        now = utcnow()
        if all_:
            self.db.execute(
                "UPDATE notifications SET read_utc=? WHERE user_id=? AND read_utc IS NULL",
                (now, user_id),
            )
        elif ids:
            for nid in ids:  # scoped on user_id: someone else's id is silently ignored
                self.db.execute(
                    "UPDATE notifications SET read_utc=? "
                    "WHERE id=? AND user_id=? AND read_utc IS NULL",
                    (now, int(nid), user_id),
                )
        return self.unread_count(user_id)


STREAK_RISK_MIN_DAYS = 2


def streak_risk_job(db: Database, stats: Any, notifier: Notifier, cfg: Any, clock: Any) -> int:
    """After ``streak_risk_hour`` (19:00 local) warn walkers whose streak is at
    stake and who have not walked today. Runs at most once per local day."""
    from .timeutil import get_tz  # local import keeps this module dependency-free

    local = clock().astimezone(get_tz(cfg.tz_name))
    if local.hour < cfg.streak_risk_hour:
        return 0
    marker = f"streak_risk:{local.date().isoformat()}"
    if db.get_setting(marker):
        return 0
    db.set_setting(marker, utcnow())
    from .stats import STREAK_MIN_M

    sent = 0
    for row in db.query("SELECT id FROM users WHERE archived=0 AND password_hash IS NOT NULL"):
        uid = row["id"]
        streak = stats.streak(uid)
        today_m = stats.reward_m_by_day(uid).get(local.date(), 0.0)
        if streak["days"] >= STREAK_RISK_MIN_DAYS and today_m < STREAK_MIN_M:
            notifier.create(
                uid, "streak_risk",
                f"Your {streak['days']}-day streak is at risk",
                "A few steps before midnight are enough to keep it.", "🔥",
                {"streak_days": streak["days"], "url": "/"},
            )
            sent += 1
    return sent
