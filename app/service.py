"""The service: everything that knows about both the treadmill and the players.

Responsibilities
----------------
* own the telemetry source and turn samples into the (single) live session
* checkpoint that session to SQLite continuously so a power cut is survivable
* derive journey progress from stored sessions (never a mutable counter)
* fire distance-keyed events once per player, ever
* wire the player-facing engines (auth, rewards, cards, quests, leaderboard,
  notifications, push) and fan state out to each connected user -- privately

The treadmill is unique: one live session at a time, owned by one user.
Everything user-facing is scoped by ``user_id``; nothing here returns another
player's private data (:mod:`app.profiles` exposes the minimal public view).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Set

from .auth import AuthService
from .ble import TelemetrySource, build_source
from .cards import CatalogStore, Collection, Wallet
from .challenges import ActiveChallenge
from .config import Config
from .content import ContentLibrary
from .db import Database, utcnow
from .errors import Conflict, Forbidden, NotFound, WalkhomeError
from .ftms import TreadmillSample
from .hub import Hub
from .leaderboard import Leaderboard
from .notifications import Notifier, streak_risk_job
from .profiles import ProfileBuilder
from .players import PlayersMixin
from .push import PushService
from .quests import QuestEngine
from .rewards import RewardEngine
from .stats import Stats
from .timeutil import Clock, parse_utc, system_clock
from .views import ViewsMixin
from .walk_events import SUBJECT_USER, EventsMixin  # noqa: F401 (re-exported)
from .tracker import DistanceTracker, LinkMonitor, WalkState

log = logging.getLogger(__name__)

MI_TO_M = 1609.344
# Reward / rank evaluation while walking is throttled to this period (seconds).
EVAL_EVERY_S = 10.0
LIVE_EVERY_S = 5.0
HOUSEKEEPING_EVERY_S = 30.0
PROFILE_TTL_S = 5.0


@dataclass
class LiveSession:
    """The walk currently in progress, held in memory and mirrored to SQLite."""

    id: int
    user_id: int
    journey_id: str
    started_at_utc: str
    tracker: DistanceTracker
    state: WalkState = WalkState.ACTIVE
    manual_pause: bool = False
    paused_at: float = 0.0
    challenge: ActiveChallenge | None = None
    pending_choice: dict | None = None
    last_checkpoint: float = 0.0
    last_eval: float = 0.0
    fired_this_session: list[dict] = field(default_factory=list)
    incline_pct: float | None = None
    heart_rate_bpm: int | None = None


class WalkhomeService(EventsMixin, PlayersMixin, ViewsMixin):
    def __init__(
        self,
        config: Config,
        db: Database,
        library: ContentLibrary,
        hub: Hub,
        source: TelemetrySource | None = None,
        clock: Clock | None = None,
        rng: random.Random | None = None,
        push_sender: Callable[[dict, str], None] | None = None,
        push_runner: Callable[..., None] | None = None,
    ) -> None:
        self.config = config
        self.db = db
        self.library = library
        self.hub = hub
        self.source = source or build_source(config)
        self.clock: Clock = clock or system_clock
        self.rng: random.Random = rng or random.SystemRandom()

        self.link = LinkMonitor(
            link_timeout_s=config.link_timeout_s,
            autopause_after_s=config.autopause_after_s,
        )
        self.link_detail = "Starting up"
        self.session: LiveSession | None = None
        self.default_journey_id = library.default_id(config.default_pack)

        self._loop: asyncio.AbstractEventLoop | None = None
        self._tasks: list[asyncio.Task] = []
        self._sample_queue: asyncio.Queue[tuple[TreadmillSample, float]] = asyncio.Queue(
            maxsize=256
        )
        self._progress_cache: dict[tuple[int, str], float] = {}
        self._recent_events: dict[int, list[dict]] = {}
        self._link_lost_at: float | None = None
        self._stopping = False
        self._walker_profile: tuple[float, int, dict] | None = None
        # Tests set this to a list to capture (user_id, type, data) instead of
        # touching the hub.
        self.outbox: list[tuple[int | None, str, Any]] | None = None

        # -- player-facing engines ------------------------------------------
        self.stats = Stats(db, config, self.clock)
        self.auth = AuthService(db, config, self.clock)
        self.store = CatalogStore(config.content_dir)
        self.wallet = Wallet(db)
        self.collection = Collection(db, self.store, self.wallet, self.rng)
        self.push = PushService(db, config, self.clock, sender=push_sender, runner=push_runner)
        self.notifier = Notifier(db, self._publish_user, self.push)
        self.rewards = RewardEngine(
            db, library, self.store, self.collection, self.wallet, self.stats, config,
            self.clock, self.notifier, self._publish_user, self.default_journey_id,
        )
        self.quests = QuestEngine(
            db, library, self.stats, self.rewards, self.wallet, config, self.clock,
            self.user_progress_m,
        )
        self.profiles = ProfileBuilder(
            db, library, self.stats, self.collection, self.progress_of, self.walking_ids
        )
        self.board = Leaderboard(
            db, library, self.stats, self.profiles, self.rewards, self.notifier,
            self._publish_user, config, self.clock,
        )

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self.push.ensure_keys()
        self._recover_open_session()
        with contextlib.suppress(Exception):
            self.board.settle_weekly_podium()
        self._tasks = [
            asyncio.create_task(self._run_source(), name="telemetry-source"),
            asyncio.create_task(self._consume_samples(), name="sample-consumer"),
            asyncio.create_task(self._tick_loop(), name="tick-loop"),
        ]
        log.info(
            "walkhome ready: journey=%s telemetry=%s",
            self.default_journey_id,
            self.source.kind,
        )

    async def stop(self) -> None:
        self._stopping = True
        if self.session:
            self._checkpoint(force=True)
        with contextlib.suppress(Exception):
            await self.source.stop()
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()
        self.push.close()

    async def _run_source(self) -> None:
        await self.source.run(self._on_sample, self._on_link)

    # -- telemetry ingress ---------------------------------------------------

    def _on_sample(self, sample: TreadmillSample) -> None:
        """Called from the BLE callback. Must not block or touch the DB."""
        if self._loop is None:
            return
        item = (sample, time.monotonic())
        try:
            self._sample_queue.put_nowait(item)
        except asyncio.QueueFull:
            with contextlib.suppress(asyncio.QueueEmpty):
                self._sample_queue.get_nowait()
            with contextlib.suppress(asyncio.QueueFull):
                self._sample_queue.put_nowait(item)

    def _on_link(self, connected: bool, detail: str) -> None:
        self.link_detail = detail
        if connected:
            self.link.on_connected(time.monotonic())
            self._link_lost_at = None
        else:
            self.link.on_disconnected()
            self._link_lost_at = time.monotonic()
        log.info("telemetry link %s: %s", "up" if connected else "down", detail)

    async def _consume_samples(self) -> None:
        while True:
            sample, at = await self._sample_queue.get()
            try:
                self._handle_sample(sample, at)
            except Exception:  # noqa: BLE001 - a bad packet must not kill the loop
                log.exception("failed to handle telemetry sample")

    def _handle_sample(self, sample: TreadmillSample, at: float) -> None:
        speed = sample.speed_kmh if sample.speed_kmh is not None else 0.0
        self.link.on_sample(speed, at)

        session = self.session
        if session is None:
            return
        if session.manual_pause:
            # Keep the link fresh but credit nothing while manually paused.
            session.tracker.speed_kmh = 0.0
            return

        before = session.tracker.distance_m
        session.tracker.on_sample(sample, at)
        credited = session.tracker.distance_m - before

        if sample.inclination_pct is not None:
            session.incline_pct = sample.inclination_pct
        if sample.heart_rate_bpm:
            session.heart_rate_bpm = sample.heart_rate_bpm

        if credited > 0:
            self._advance_progress(session, credited)

    # -- the treadmill -------------------------------------------------------

    def walking_ids(self) -> Set[int]:
        return {self.session.user_id} if self.session else set()

    def treadmill(self) -> dict:
        """Is the belt taken, and by whom (public profile only)."""
        session = self.session
        if session is None:
            return {"busy": False, "walker": None}
        now = time.monotonic()
        cached = self._walker_profile
        if cached and cached[1] == session.user_id and now - cached[0] < PROFILE_TTL_S:
            return {"busy": True, "walker": cached[2]}
        profile = self.profiles.by_id(session.user_id)
        self._walker_profile = (now, session.user_id, profile) if profile else None
        return {"busy": True, "walker": profile}

    def live_walkers(self) -> list[dict]:
        """Full presence for ``GET /api/live``."""
        session = self.session
        if session is None:
            return []
        profile = self.profiles.by_id(session.user_id)
        if profile is None:
            return []
        return [{
            "profile": profile,
            "speed_kmh": round(session.tracker.speed_kmh, 2),
            "session_distance_m": round(session.tracker.distance_m, 1),
        }]

    def live_brief(self) -> dict:
        """Minimal public presence for the WS ``live`` message."""
        session = self.session
        if session is None:
            return {"walkers": []}
        user = self.get_user(session.user_id) or {}
        return {"walkers": [{
            "user_id": session.user_id,
            "display_name": user.get("display_name", "?"),
            "avatar": user.get("avatar", "🚶"),
            "color": user.get("color", "#8ecae6"),
            "speed_kmh": round(session.tracker.speed_kmh, 2),
        }]}

    # -- session lifecycle ---------------------------------------------------

    def start_session(self, user_id: int, journey_id: str | None = None) -> dict:
        user = self.get_user(user_id)
        if user is None:
            raise NotFound("no such player")
        if self.session is not None:
            if self.session.user_id == user_id:
                raise Conflict("you already have a walk in progress", "already_walking")
            raise Conflict("the treadmill is in use by someone else", "treadmill_busy")
        journey_id = journey_id or user.get("journey_id") or self.default_journey_id
        try:
            self.library.require(journey_id)
        except KeyError as exc:
            raise WalkhomeError(str(exc.args[0]), 400, "unknown_theme")
        if user.get("journey_id") != journey_id:
            self.db.execute("UPDATE users SET journey_id=? WHERE id=?", (journey_id, user_id))

        # Remember the standings as they are *before* this walk moves anyone.
        with contextlib.suppress(Exception):
            self.board.snapshot_baseline(journey_id)

        now = utcnow()
        session_id = self.db.insert(
            "INSERT INTO sessions (user_id, journey_id, source, state, start_utc, "
            "updated_utc) VALUES (?, ?, 'treadmill', 'active', ?, ?)",
            (user_id, journey_id, now, now),
        )
        self.session = LiveSession(
            id=session_id,
            user_id=user_id,
            journey_id=journey_id,
            started_at_utc=now,
            tracker=self._new_tracker(),
            last_checkpoint=time.monotonic(),
            last_eval=time.monotonic(),
        )
        self._walker_profile = None
        log.info("session %s started for %s", session_id, user["display_name"])
        self._publish_state_change(user_id)
        return self.session_snapshot()  # type: ignore[return-value]

    def _new_tracker(self, distance_m: float = 0.0, elapsed_s: float = 0.0):
        kwargs = dict(
            max_gap_s=self.config.max_integration_gap_s,
            reconcile_every_s=self.config.reconcile_every_s,
            reconcile_max_drift_ratio=self.config.reconcile_max_drift_ratio,
            reconcile_min_abs_m=self.config.reconcile_min_abs_m,
        )
        if distance_m or elapsed_s:
            return DistanceTracker.resumed(distance_m, elapsed_s, **kwargs)
        return DistanceTracker(**kwargs)

    def pause_session(self, user_id: int) -> dict:
        session = self._require_session(user_id)
        session.manual_pause = True
        session.paused_at = time.monotonic()
        session.state = WalkState.PAUSED
        self._checkpoint(force=True)
        self._publish_state_change(user_id)
        return self.session_snapshot()  # type: ignore[return-value]

    def resume_session(self, user_id: int) -> dict:
        session = self._require_session(user_id)
        session.manual_pause = False
        # Drop the integration anchor so the paused interval is never credited.
        session.tracker._last_ts = None  # noqa: SLF001 - same module family
        self._checkpoint(force=True)
        self._publish_state_change(user_id)
        return self.session_snapshot()  # type: ignore[return-value]

    def stop_session(self, user_id: int, note: str | None = None) -> dict:
        session = self._require_session(user_id)
        return self._end_session(session, note)

    def _end_session(self, session: LiveSession, note: str | None = None) -> dict:
        self._resolve_challenge(session, force_fail=True)
        self._checkpoint(force=True, end=True, note=note)
        summary = self._session_row(session.id)
        self.session = None
        self._walker_profile = None
        self._invalidate(session.user_id)
        log.info(
            "session %s ended: %.0f m in %.0f s",
            summary["id"], summary["distance_m"], summary["elapsed_s"],
        )
        self._after_credit(session.user_id, session.journey_id)
        self._publish_state_change(session.user_id)
        return summary

    def _require_session(self, user_id: int) -> LiveSession:
        if self.session is None:
            raise WalkhomeError("no walk is in progress", 400, "no_walk")
        if self.session.user_id != user_id:
            raise Forbidden("the walk in progress is not yours", "not_your_walk")
        return self.session

    def _recover_open_session(self) -> None:
        """Resume (or cleanly close) a session interrupted by a crash/reboot.

        The session keeps the ``user_id`` it was recorded with, so after a
        reboot the walk is still attached to the right person.
        """
        row = self.db.query_one(
            "SELECT * FROM sessions WHERE end_utc IS NULL ORDER BY id DESC LIMIT 1"
        )
        if row is None:
            return
        updated = parse_utc(row["updated_utc"])
        age_s = (
            (self.clock() - updated).total_seconds() if updated else 1e9
        )
        if age_s > self.config.stale_session_close_s:
            self.db.execute(
                "UPDATE sessions SET end_utc=?, state='ended', updated_utc=?, "
                "note=COALESCE(note,'') || ' [auto-closed after restart]' "
                "WHERE id=?",
                (row["updated_utc"], utcnow(), row["id"]),
            )
            log.info(
                "closed stale session %s (%.0f min old) on startup", row["id"], age_s / 60
            )
            self._invalidate()
            return

        self.session = LiveSession(
            id=row["id"],
            user_id=row["user_id"],
            journey_id=row["journey_id"],
            started_at_utc=row["start_utc"],
            tracker=self._new_tracker(row["distance_m"], row["elapsed_s"]),
            state=WalkState.PAUSED,
            manual_pause=False,
            last_checkpoint=time.monotonic(),
            last_eval=time.monotonic(),
        )
        log.info(
            "resumed session %s (user %s) at %.0f m (interrupted %.0f s ago)",
            row["id"], row["user_id"], row["distance_m"], age_s,
        )

    # -- checkpointing -------------------------------------------------------

    def _checkpoint(
        self, force: bool = False, end: bool = False, note: str | None = None
    ) -> None:
        session = self.session
        if session is None:
            return
        now = time.monotonic()
        if not force and now - session.last_checkpoint < self.config.checkpoint_every_s:
            return
        session.last_checkpoint = now
        t = session.tracker
        self.db.execute(
            "UPDATE sessions SET distance_m=?, device_distance_m=?, elapsed_s=?, "
            "moving_s=?, max_speed_kmh=?, avg_hr_bpm=?, state=?, updated_utc=?, "
            "end_utc=COALESCE(?, end_utc), note=COALESCE(?, note) WHERE id=?",
            (
                t.distance_m,
                t.device_m if t.drift_m is not None else None,
                t.elapsed_s,
                t.moving_s,
                t.max_speed_kmh,
                t.avg_hr_bpm,
                "ended" if end else session.state.value,
                utcnow(),
                utcnow() if end else None,
                note,
                session.id,
            ),
        )

    # -- progress ------------------------------------------------------------

    def user_progress_m(self, user_id: int, journey_id: str) -> float:
        """Derived, never stored: sum of this walker's sessions + adjustments.

        The per-walker handicap scales treadmill distance (so a seven-year-old
        and an adult can reach milestones on a similar cadence); manual
        adjustments are taken at face value.
        """
        row = self.db.query_one(
            "SELECT COALESCE(SUM(distance_m), 0) AS d FROM sessions "
            "WHERE user_id=? AND journey_id=?",
            (user_id, journey_id),
        )
        walked = float(row["d"]) if row else 0.0
        adj_row = self.db.query_one(
            "SELECT COALESCE(SUM(delta_m), 0) AS d FROM adjustments "
            "WHERE user_id=? AND journey_id=?",
            (user_id, journey_id),
        )
        adjusted = float(adj_row["d"]) if adj_row else 0.0
        user = self.get_user(user_id)
        handicap = float(user["handicap"]) if user else 1.0
        return max(0.0, walked * handicap + adjusted)

    def progress_of(self, user_id: int, journey_id: str) -> float:
        """Cached derived progress (the cache only avoids re-summing at 1 Hz)."""
        key = (user_id, journey_id)
        if key not in self._progress_cache:
            s = self.session
            if s and s.user_id == user_id and s.journey_id == journey_id:
                self._checkpoint(force=True)  # make the DB sum include the live walk
            self._progress_cache[key] = self.user_progress_m(user_id, journey_id)
        return self._progress_cache[key]

    def _invalidate(self, user_id: int | None = None) -> None:
        """Forget cached derivations after a data change (they rebuild lazily)."""
        if user_id is None:
            self._progress_cache.clear()
        else:
            for key in [k for k in self._progress_cache if k[0] == user_id]:
                del self._progress_cache[key]
        self.stats.invalidate(user_id)
        self.board.invalidate()

    def _advance_progress(self, session: LiveSession, credited_m: float) -> None:
        """Move the walker forward and fire anything crossed."""
        user = self.get_user(session.user_id)
        handicap = float(user["handicap"]) if user else 1.0
        gained = credited_m * handicap
        journey = self.library.require(session.journey_id)

        key = (session.user_id, session.journey_id)
        cached = self._progress_cache.get(key)
        if cached is None:
            # Rebuilt from the DB, which already includes this sample.
            after = self.progress_of(*key)
            before = max(0.0, after - gained)
        else:
            before = cached
            after = before + gained
            self._progress_cache[key] = after
        after = min(after, journey.total_m)
        before = min(before, after)
        fired = self._fire_events(journey, session.user_id, before, after, session)
        if any(e.get("kind") == "milestone" for e in fired):
            self._after_credit(session.user_id, session.journey_id, force=True)

    def _after_credit(self, user_id: int, journey_id: str, force: bool = True) -> None:
        """Run the derived engines that react to new distance: rewards + overtakes."""
        try:
            self.stats.invalidate(user_id)
            self.rewards.evaluate(user_id)
            self.board.check_overtakes(user_id, journey_id)
        except Exception:  # noqa: BLE001 - a reward bug must never stop a walk
            log.exception("post-credit evaluation failed")

    # -- the tick loop -------------------------------------------------------

    async def _tick_loop(self) -> None:
        last = time.monotonic()
        last_live = 0.0
        last_house = 0.0
        while not self._stopping:
            await asyncio.sleep(self.config.tick_every_s)
            now = time.monotonic()
            dt = now - last
            last = now
            try:
                self._tick(now, dt)
                walker = self.session.user_id if self.session else None
                if walker is not None:
                    # Private: only the person on the belt gets the 1 Hz tick.
                    await self.hub.broadcast(
                        "tick", self.snapshot_for(walker, light=True), user_id=walker
                    )
                if now - last_live >= LIVE_EVERY_S:
                    last_live = now
                    await self.hub.broadcast("live", self.live_brief())
                if now - last_house >= HOUSEKEEPING_EVERY_S:
                    last_house = now
                    self.housekeeping()
            except Exception:  # noqa: BLE001 - the loop must survive anything
                log.exception("tick failed")

    def housekeeping(self) -> None:
        """Slow periodic jobs: weekly podium, streak reminders, token cleanup."""
        self.board.settle_weekly_podium()
        streak_risk_job(self.db, self.stats, self.notifier, self.config, self.clock)
        self.auth.purge_expired()

    def _tick(self, now: float, dt: float) -> None:
        session = self.session
        if session is None:
            return

        if session.manual_pause:
            session.state = WalkState.PAUSED
            session.tracker.speed_kmh = 0.0
        else:
            session.state = self.link.walk_state(now)
            if session.state is not WalkState.ACTIVE:
                # No live samples means no speed; do not let the parallax coast
                # forever on a stale value.
                session.tracker.speed_kmh = 0.0

        self._update_challenge(session, now, dt)
        self._checkpoint()

        if now - session.last_eval >= EVAL_EVERY_S and session.tracker.distance_m > 0:
            session.last_eval = now
            self._checkpoint(force=True)
            self._after_credit(session.user_id, session.journey_id)

        if self._session_idle_seconds(session, now) >= self.config.stale_session_close_s:
            log.info("auto-ending unattended session %s", session.id)
            self._end_session(session, note="auto-ended after inactivity")

    def _session_idle_seconds(self, session: LiveSession, now: float) -> float:
        """How long this session has been going nowhere.

        Zero while the belt is moving. A manual pause, an auto-pause and a dead
        link all count as idle -- an unattended session left overnight should
        close itself rather than sit open until someone notices.
        """
        if session.manual_pause:
            return now - session.paused_at if session.paused_at else 0.0
        if session.state is WalkState.ACTIVE:
            return 0.0
        if session.state is WalkState.NO_LINK:
            # Idle since the last sample, or since the link went down --
            # never "forever" just because the sample timestamp was cleared.
            anchor = self.link.last_sample_ts or self._link_lost_at
            return now - anchor if anchor else 0.0
        return self.link.idle_for(now)

    # -- fan-out helpers -----------------------------------------------------

    def _publish_state_change(self, user_id: int) -> None:
        """Something about the walk changed: resync its owner, tell everyone presence."""
        if self.outbox is None and not (self._loop and self._loop.is_running()):
            return  # nobody can be listening yet (startup, unit tests)
        self._publish("snapshot", self.snapshot_for(user_id), user_id=user_id)
        self._publish("live", self.live_brief())

    def _publish_user(self, user_id: int, message_type: str, data: Any) -> None:
        self._publish(message_type, data, user_id=user_id)

    def _publish(self, message_type: str, data: Any, user_id: int | None = None) -> None:
        """Fire-and-forget send from synchronous code.

        ``user_id`` set  => private to that user's sockets.
        ``user_id`` None => public (only ever ``live``).
        """
        if self.outbox is not None:
            self.outbox.append((user_id, message_type, data))
            return
        loop = self._loop
        if loop is None or not loop.is_running():
            return
        coro = self.hub.broadcast(message_type, data, user_id=user_id)
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run_coroutine_threadsafe(coro, loop)
        else:
            task = asyncio.create_task(coro)
            self._tasks_cleanup(task)

    def _tasks_cleanup(self, task: asyncio.Task) -> None:
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
