"""JSON views: ``Me``, ``Subject``, the live session and the private ``Snapshot``
(mixin of WalkhomeService)."""

from __future__ import annotations

import time

from .errors import NotFound

SUBJECT_USER = "user"


class ViewsMixin:
    # -- views ---------------------------------------------------------------

    def me_view(self, user: dict) -> dict:
        uid = user["id"]
        return {
            "id": uid,
            "username": user["username"],
            "display_name": user["display_name"],
            "avatar": user["avatar"],
            "color": user["color"],
            "journey_id": user["journey_id"] or self.default_journey_id,
            "is_admin": bool(user["is_admin"]),
            "handicap": user["handicap"],
            "daily_goal_m": user["daily_goal_m"],
            "units": user["units"],
            "created_utc": user["created_utc"],
            "wallet": {"essence": self.wallet.essence(uid)},
            "unopened_packs": self.rewards.unopened_count(uid),
            "push": {
                "supported": self.push.supported,
                "subscribed": self.push.is_subscribed(uid),
            },
        }

    def subject_view(self, user_id: int, journey_id: str) -> dict:
        journey = self.library.require(journey_id)
        user = self.get_user(user_id) or {}
        progress = self.progress_of(user_id, journey_id)
        biome = journey.biome_at(progress)
        stage = journey.stage_at(progress)
        next_milestone = journey.next_event(progress, kind="milestone")
        view = {
            "kind": SUBJECT_USER,
            "id": user_id,
            "journey_id": journey_id,
            "progress_m": round(progress, 1),
            "fraction": round(journey.progress_fraction(progress), 5),
            "remaining_m": round(max(0.0, journey.total_m - progress), 1),
            "biome": biome,
            "stage": stage,
            "last_event": journey.last_event(progress),
            "next_milestone": next_milestone,
            "next_milestone_in_m": (
                round(next_milestone["at_m"] - progress, 1) if next_milestone else None
            ),
            "finished": progress >= journey.total_m,
            "display_name": user.get("display_name"),
            "avatar": user.get("avatar"),
            "color": user.get("color"),
            "handicap": user.get("handicap"),
            "daily_goal_m": user.get("daily_goal_m"),
        }
        pace = self.stats.recent_pace_m_per_day(user_id)
        view["pace_m_per_day"] = round(pace, 1)
        if next_milestone and pace > 0:
            view["eta_days_to_milestone"] = round(
                (next_milestone["at_m"] - progress) / pace, 1
            )
            view["eta_days_to_finish"] = round((journey.total_m - progress) / pace, 1)
        return view

    def session_snapshot(self) -> dict | None:
        """The live walk (callers must only hand this to its owner)."""
        session = self.session
        if session is None:
            return None
        now = time.monotonic()
        user = self.get_user(session.user_id) or {}
        journey = self.library.require(session.journey_id)
        t = session.tracker
        subject_progress = self.progress_of(session.user_id, session.journey_id)
        return {
            "id": session.id,
            "user": {
                "id": session.user_id,
                "display_name": user.get("display_name", "?"),
                "avatar": user.get("avatar", "🚶"),
                "color": user.get("color", "#8ecae6"),
                "handicap": user.get("handicap", 1.0),
            },
            "journey_id": session.journey_id,
            "state": session.state.value,
            "manual_pause": session.manual_pause,
            "started_at": session.started_at_utc,
            "telemetry": t.snapshot(),
            "incline_pct": session.incline_pct,
            "heart_rate_bpm": session.heart_rate_bpm,
            "progress_m": round(subject_progress, 1),
            "fraction": round(journey.progress_fraction(subject_progress), 5),
            "biome": journey.biome_at(subject_progress),
            "stage": journey.stage_at(subject_progress),
            "next_milestone": journey.next_event(subject_progress, kind="milestone"),
            "challenge": session.challenge.snapshot(now) if session.challenge else None,
            "pending_choice": session.pending_choice,
        }

    def snapshot_for(self, user_id: int, light: bool = False) -> dict:
        """The private ``Snapshot`` of one user (docs/CONTRACT.md section 8)."""
        user = self.get_user(user_id)
        if user is None:
            raise NotFound("no such player")
        now = time.monotonic()
        journey_id = user["journey_id"] or self.default_journey_id
        mine = self.session if self.session and self.session.user_id == user_id else None
        state = {
            "me": self.me_view(user),
            "journey_id": journey_id,
            "units": user["units"],
            "link": {
                "state": self.link.link_state(now).value,
                "detail": self.link_detail,
                "source": self.source.kind,
            },
            "treadmill": self.treadmill(),
            "session": self.session_snapshot() if mine else None,
            "subject": self.subject_view(user_id, journey_id),
            "packs": self.rewards.packs_brief(user_id),
            "rank": self.board.ranks_brief(user_id, journey_id),
            "unread_notifications": self.notifier.unread_count(user_id),
        }
        if not light:
            state["recent_events"] = self._recent_events.get(user_id, [])[-8:]
        return state
