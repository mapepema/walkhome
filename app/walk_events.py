"""The journey event engine and in-walk challenges (mixin of WalkhomeService).

Kept apart from :mod:`app.service` so the orchestrator stays readable. Events
are idempotent per (player, event) via the UNIQUE constraint on
``fired_events``; challenges only ever *read* speed/incline (never FTMS writes).
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from .challenges import ActiveChallenge, ChallengeState
from .content import Journey
from .db import utcnow
from .errors import WalkhomeError

if TYPE_CHECKING:  # pragma: no cover
    from .service import LiveSession

log = logging.getLogger(__name__)

SUBJECT_USER = "user"


class EventsMixin:
    # -- the event engine ----------------------------------------------------

    def _fire_events(
        self,
        journey: Journey,
        user_id: int,
        before_m: float,
        after_m: float,
        session: LiveSession | None,
    ) -> list[dict]:
        fired: list[dict] = []
        # The interval is half-open on the left so stalling on a milepost never
        # re-fires it -- but the departure event sits at exactly 0, so the very
        # first step must look back far enough to include it. The UNIQUE
        # constraint on fired_events keeps this idempotent regardless.
        start_m = before_m if before_m > 0 else -1.0
        for event in journey.events_between(start_m, after_m):
            if not self._record_fired(journey, user_id, event, after_m, session):
                continue
            fired.append(event)
            self._write_journal(journey, user_id, event, after_m)
            payload = {
                "subject": {"kind": SUBJECT_USER, "id": user_id},
                "journey_id": journey.id,
                "at_m": after_m,
                "event": event,
            }
            self._remember_event(user_id, payload)
            self._publish("event", payload, user_id=user_id)

            # Interactive events only make sense for the walker who is
            # actually on the belt.
            if session is not None and session.user_id == user_id:
                if event.get("kind") == "challenge" and session.challenge is None:
                    self._start_challenge(session, event)
                elif event.get("kind") == "choice":
                    session.pending_choice = {
                        "event_id": event["id"],
                        "title": event["title"],
                        "body": event["body"],
                        "options": event.get("choice", {}).get("options", []),
                    }
        return fired

    def _record_fired(
        self,
        journey: Journey,
        user_id: int,
        event: dict,
        at_m: float,
        session: LiveSession | None,
    ) -> bool:
        """Insert the fired-event row. False if it had already fired."""
        cur = self.db.execute(
            "INSERT OR IGNORE INTO fired_events (journey_id, subject_kind, "
            "subject_id, event_id, session_id, at_m, fired_utc) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                journey.id,
                SUBJECT_USER,
                user_id,
                event["id"],
                session.id if session else None,
                at_m,
                utcnow(),
            ),
        )
        return cur.rowcount > 0

    def _write_journal(
        self, journey: Journey, user_id: int, event: dict, at_m: float
    ) -> None:
        self.db.insert(
            "INSERT INTO journal (journey_id, subject_kind, subject_id, kind, "
            "title, body, at_m, icon, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                journey.id,
                SUBJECT_USER,
                user_id,
                event.get("kind", "beat"),
                event["title"],
                event.get("body", ""),
                at_m,
                event.get("icon"),
                utcnow(),
            ),
        )

    def _remember_event(self, user_id: int, payload: dict) -> None:
        events = self._recent_events.setdefault(user_id, [])
        events.append(payload)
        del events[:-20]

    # -- challenges ----------------------------------------------------------

    def _start_challenge(self, session: LiveSession, event: dict) -> None:
        incline_supported = session.incline_pct is not None
        challenge = ActiveChallenge.from_event(
            event, time.monotonic(), incline_supported=incline_supported
        )
        if challenge is None:
            return
        session.challenge = challenge
        self._publish(
            "challenge",
            {"phase": "started", "challenge": challenge.snapshot(time.monotonic())},
            user_id=session.user_id,
        )
        log.info("challenge started: %s", challenge.title)

    def _update_challenge(self, session: LiveSession, now: float, dt: float) -> None:
        challenge = session.challenge
        if challenge is None:
            return
        if session.manual_pause:
            return
        state = challenge.update(
            session.tracker.speed_kmh, session.incline_pct, now, dt
        )
        if state is not ChallengeState.RUNNING:
            self._resolve_challenge(session)

    def _resolve_challenge(self, session: LiveSession, force_fail: bool = False) -> None:
        challenge = session.challenge
        if challenge is None:
            return
        if force_fail and challenge.state is ChallengeState.RUNNING:
            challenge.state = ChallengeState.FAILED
        session.challenge = None
        succeeded = challenge.state is ChallengeState.SUCCEEDED
        self.db.insert(
            "INSERT INTO challenge_results (session_id, user_id, event_id, title, "
            "succeeded, detail, created_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                session.id,
                session.user_id,
                challenge.event_id,
                challenge.title,
                1 if succeeded else 0,
                challenge.result_text(),
                utcnow(),
            ),
        )
        self.db.insert(
            "INSERT INTO journal (journey_id, subject_kind, subject_id, kind, "
            "title, body, at_m, icon, created_utc) "
            "VALUES (?, ?, ?, 'challenge', ?, ?, ?, ?, ?)",
            (
                session.journey_id,
                SUBJECT_USER,
                session.user_id,
                challenge.title,
                challenge.result_text(),
                self.progress_of(session.user_id, session.journey_id),
                "🏅" if succeeded else "🫥",
                utcnow(),
            ),
        )
        self._publish(
            "challenge",
            {
                "phase": "finished",
                "title": challenge.title,
                "icon": challenge.icon,
                "succeeded": succeeded,
                "text": challenge.result_text(),
                "held_s": round(challenge.best_held_s, 1),
                "duration_s": challenge.duration_s,
            },
            user_id=session.user_id,
        )

    def answer_choice(self, user_id: int, event_id: str, option_id: str) -> dict:
        session = self._require_session(user_id)
        pending = session.pending_choice
        if not pending or pending["event_id"] != event_id:
            raise WalkhomeError("that choice is not open", 400, "choice_closed")
        option = next(
            (o for o in pending["options"] if o["id"] == option_id), None
        )
        if option is None:
            raise WalkhomeError(f"unknown option {option_id!r}", 400, "bad_option")
        session.pending_choice = None
        self.db.insert(
            "INSERT INTO journal (journey_id, subject_kind, subject_id, kind, "
            "title, body, at_m, icon, created_utc) "
            "VALUES (?, 'user', ?, 'choice', ?, ?, ?, '🧭', ?)",
            (
                session.journey_id,
                session.user_id,
                f"{pending['title']} — {option['label']}",
                option.get("outcome", ""),
                self.progress_of(session.user_id, session.journey_id),
                utcnow(),
            ),
        )
        result = {"event_id": event_id, "option": option}
        self._publish_state_change(user_id)
        return result
