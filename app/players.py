"""Players, their sessions and history (mixin of WalkhomeService).

Every method takes the acting ``user_id`` and only ever touches that player's
rows -- the isolation guarantee lives here, not in the HTTP layer alone.
"""

from __future__ import annotations

import contextlib
from datetime import timedelta
from typing import Any

from .db import utcnow
from .errors import Conflict, NotFound, WalkhomeError
from .timeutil import iso, parse_utc

MANUAL_FUTURE_SLACK = timedelta(minutes=5)
MAX_MANUAL_M = 200_000
USER_EDITABLE = ("display_name", "avatar", "color", "daily_goal_m", "journey_id", "units")


class PlayersMixin:
    # -- players -------------------------------------------------------------

    def list_users(self, include_archived: bool = False) -> list[dict]:
        sql = "SELECT * FROM users"
        if not include_archived:
            sql += " WHERE archived=0"
        sql += " ORDER BY id"
        return [self._clean(dict(r)) for r in self.db.query(sql)]

    def get_user(self, user_id: int) -> dict | None:
        row = self.db.query_one("SELECT * FROM users WHERE id=?", (user_id,))
        return self._clean(dict(row)) if row else None

    @staticmethod
    def _clean(user: dict) -> dict:
        """Never hand the password hash around."""
        user["has_password"] = user.get("password_hash") is not None
        user.pop("password_hash", None)
        return user

    def register(self, **kwargs: Any) -> dict:
        """Create an account (first one = admin) and give the welcome packs."""
        journey_id = kwargs.get("journey_id") or self.default_journey_id
        if self.library.get(journey_id) is None:
            raise WalkhomeError(f"unknown theme {journey_id!r}", 400, "unknown_theme")
        kwargs["journey_id"] = journey_id
        user = self.auth.register(**kwargs)
        self._onboard(user["id"])
        return self.get_user(user["id"])  # type: ignore[return-value]

    def claim(self, username: str, password: str, ip: str = "-") -> dict:
        user = self.auth.claim(username, password, ip)
        self._onboard(user["id"])
        return self.get_user(user["id"])  # type: ignore[return-value]

    def _onboard(self, user_id: int) -> None:
        grants = self.rewards.grant_welcome(user_id)
        if grants:
            self.rewards.announce(user_id, grants, "welcome", "Welcome to Walkhome!")

    def update_profile(self, user_id: int, **fields: Any) -> dict:
        updates = {k: v for k, v in fields.items() if k in USER_EDITABLE and v is not None}
        if "journey_id" in updates:
            if self.session and self.session.user_id == user_id:
                raise Conflict("finish your walk before changing theme", "walk_in_progress")
            if self.library.get(updates["journey_id"]) is None:
                raise WalkhomeError("unknown theme", 400, "unknown_theme")
        if updates:
            assignments = ", ".join(f"{k}=?" for k in updates)
            try:
                self.db.execute(
                    f"UPDATE users SET {assignments} WHERE id=?", (*updates.values(), user_id)
                )
            except Exception as exc:  # noqa: BLE001
                if "UNIQUE" in str(exc).upper():
                    raise Conflict("display name already taken", "display_name_taken")
                raise
            self._invalidate(user_id)
            self._walker_profile = None
        return self.get_user(user_id)  # type: ignore[return-value]

    def admin_update_user(self, user_id: int, **fields: Any) -> dict:
        if self.get_user(user_id) is None:
            raise NotFound("no such player")
        allowed = {"handicap", "archived", "is_admin", "daily_goal_m"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if updates:
            assignments = ", ".join(f"{k}=?" for k in updates)
            self.db.execute(
                f"UPDATE users SET {assignments} WHERE id=?", (*updates.values(), user_id)
            )
            self._invalidate()
        return self.get_user(user_id)  # type: ignore[return-value]

    def delete_user(self, user_id: int) -> None:
        """Remove a player and everything they logged (admin only)."""
        if self.session and self.session.user_id == user_id:
            raise Conflict("this player has a walk in progress", "walk_in_progress")
        if self.get_user(user_id) is None:
            raise NotFound("no such player")
        for table in ("challenge_results", "adjustments", "sessions"):
            self.db.execute(f"DELETE FROM {table} WHERE user_id=?", (user_id,))
        self.db.execute(
            "DELETE FROM fired_events WHERE subject_kind='user' AND subject_id=?", (user_id,)
        )
        self.db.execute(
            "DELETE FROM journal WHERE subject_kind='user' AND subject_id=?", (user_id,)
        )
        self.db.execute("DELETE FROM users WHERE id=?", (user_id,))  # cascades the rest
        self._invalidate()

    # -- sessions ------------------------------------------------------------

    def list_sessions(self, user_id: int, limit: int = 50) -> list[dict]:
        rows = self.db.query(
            "SELECT s.*, u.display_name, u.avatar, u.color FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.user_id=? "
            "ORDER BY s.start_utc DESC LIMIT ?",
            (user_id, limit),
        )
        return [dict(r) for r in rows]

    def _session_row(self, session_id: int) -> dict:
        row = self.db.query_one("SELECT * FROM sessions WHERE id=?", (session_id,))
        if row is None:
            raise NotFound(f"no such session {session_id}")
        return dict(row)

    def _own_session(self, user_id: int, session_id: int) -> dict:
        row = self.db.query_one(
            "SELECT * FROM sessions WHERE id=? AND user_id=?", (session_id, user_id)
        )
        if row is None:  # same answer whether it exists for someone else or not
            raise NotFound("no such session")
        return dict(row)

    def update_session_note(self, user_id: int, session_id: int, note: str) -> dict:
        self._own_session(user_id, session_id)
        self.db.execute(
            "UPDATE sessions SET note=?, updated_utc=? WHERE id=? AND user_id=?",
            (note[:500], utcnow(), session_id, user_id),
        )
        return self._own_session(user_id, session_id)

    def delete_session(self, user_id: int, session_id: int) -> None:
        self._own_session(user_id, session_id)
        if self.session and self.session.id == session_id:
            raise Conflict("finish the walk before deleting it", "walk_in_progress")
        self.db.execute(
            "DELETE FROM sessions WHERE id=? AND user_id=?", (session_id, user_id)
        )
        self._invalidate(user_id)

    def add_manual_session(
        self,
        user_id: int,
        distance_m: float,
        minutes: float = 0.0,
        note: str = "",
        when_utc: str | None = None,
        journey_id: str | None = None,
    ) -> dict:
        """An outdoor walk, or a treadmill session done without the app.

        It counts for progress and the leaderboard; rewards are capped
        (``stats.rewardable_manual_m``).
        """
        if not 0 < distance_m <= MAX_MANUAL_M:
            raise WalkhomeError("distance out of range", 400, "bad_distance")
        user = self.get_user(user_id)
        if user is None:
            raise NotFound("no such player")
        journey_id = journey_id or user.get("journey_id") or self.default_journey_id
        self.library.require(journey_id)
        when = parse_utc(when_utc) if when_utc else self.clock()
        if when is None:
            raise WalkhomeError("when_utc is not a valid timestamp", 400, "bad_date")
        if when > self.clock() + MANUAL_FUTURE_SLACK:
            raise WalkhomeError("a walk cannot be in the future", 400, "bad_date")
        stamp = iso(when)
        with contextlib.suppress(Exception):
            self.board.snapshot_baseline(journey_id)
        session_id = self.db.insert(
            "INSERT INTO sessions (user_id, journey_id, source, state, start_utc, "
            "end_utc, distance_m, elapsed_s, moving_s, note, updated_utc) "
            "VALUES (?, ?, 'manual', 'ended', ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id, journey_id, stamp, stamp, float(distance_m),
                minutes * 60.0, minutes * 60.0, (note or "")[:500], utcnow(),
            ),
        )
        self._sync_after_change(user_id, journey_id, float(distance_m) * float(user["handicap"]))
        self._after_credit(user_id, journey_id)
        return self._session_row(session_id)

    def add_adjustment(
        self, user_id: int, delta_m: float, reason: str = "", journey_id: str | None = None
    ) -> dict:
        user = self.get_user(user_id)
        if user is None:
            raise NotFound("no such player")
        journey_id = journey_id or user.get("journey_id") or self.default_journey_id
        self.library.require(journey_id)
        adj_id = self.db.insert(
            "INSERT INTO adjustments (user_id, journey_id, delta_m, reason, created_utc) "
            "VALUES (?, ?, ?, ?, ?)",
            (user_id, journey_id, float(delta_m), reason, utcnow()),
        )
        self._sync_after_change(user_id, journey_id, float(delta_m))
        self._after_credit(user_id, journey_id)
        return {"id": adj_id, "user_id": user_id, "delta_m": delta_m, "reason": reason}

    def _sync_after_change(self, user_id: int, journey_id: str, delta_m: float) -> None:
        """Recompute progress after an out-of-band change and fire what it crossed."""
        journey = self.library.require(journey_id)
        self._invalidate(user_id)
        after = self.progress_of(user_id, journey_id)
        before = max(0.0, after - delta_m)
        if after > before:
            self._fire_events(journey, user_id, min(before, after), min(after, journey.total_m), None)

    # -- journal & stats -----------------------------------------------------

    def journal(self, user_id: int, limit: int = 40) -> list[dict]:
        rows = self.db.query(
            "SELECT * FROM journal WHERE subject_kind='user' AND subject_id=? "
            "ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        )
        return [dict(r) for r in rows]

    def daily_totals(self, user_id: int, days: int = 30) -> list[dict]:
        return self.stats.daily_totals(user_id, days)

    def streak(self, user_id: int) -> dict:
        return self.stats.streak(user_id)
