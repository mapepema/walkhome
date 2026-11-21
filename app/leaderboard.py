"""Leaderboards, overtakes and the weekly podium.

Standings are *derived* from sessions (raw walked distance in the period, per
theme). The only persisted state is ``rank_snapshots`` -- the last evaluated
weekly standings, so an overtake is "was behind at the last look, ahead now" --
and the podium settle markers, which keep the weekly payout single-shot.
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from .config import Config
from .content import ContentLibrary
from .db import Database, utcnow
from .errors import WalkhomeError
from .notifications import Notifier
from .profiles import ProfileBuilder
from .rewards import PODIUM_PACKS, RewardEngine
from .stats import Stats
from .timeutil import (
    Clock, day_start_utc, iso, month_bounds_utc, week_bounds_utc, week_key, week_start_date,
)

log = logging.getLogger(__name__)

PERIODS = ("week", "month", "all")
MAX_ROWS = 100
MIN_OVERTAKE_M = 1000.0   # the person overtaken must have walked at least this much
MIN_PODIUM_M = 1000.0

Publish = Callable[[int, str, dict], None]
Standing = Tuple[int, float]


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


class Leaderboard:
    def __init__(
        self,
        db: Database,
        library: ContentLibrary,
        stats: Stats,
        profiles: ProfileBuilder,
        rewards: RewardEngine,
        notifier: Notifier,
        publish: Publish,
        cfg: Config,
        clock: Clock,
    ) -> None:
        self.db = db
        self.library = library
        self.stats = stats
        self.profiles = profiles
        self.rewards = rewards
        self.notifier = notifier
        self.publish = publish
        self.cfg = cfg
        self.clock = clock
        self.cache_ttl_s = 5.0
        self._cache: Dict[tuple, Tuple[float, list]] = {}
        self._podium_checked_for: Optional[str] = None

    # -- standings ---------------------------------------------------------

    def window(self, period: str) -> Tuple[Optional[str], Optional[str]]:
        if period not in PERIODS:
            raise WalkhomeError("period must be week, month or all", 400, "bad_period")
        today, tz = self.stats.today(), self.stats.tz
        if period == "week":
            a, b = week_bounds_utc(today, tz)
        elif period == "month":
            a, b = month_bounds_utc(today, tz)
        else:
            return None, None
        return iso(a), iso(b)

    def standings(
        self, journey_id: str, start: Optional[str] = None, end: Optional[str] = None
    ) -> List[Standing]:
        sql = (
            "SELECT s.user_id AS uid, SUM(s.distance_m) AS d FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.journey_id=? AND u.archived=0"
        )
        params: list = [journey_id]
        if start:
            sql += " AND s.start_utc >= ?"
            params.append(start)
        if end:
            sql += " AND s.start_utc < ?"
            params.append(end)
        sql += " GROUP BY s.user_id HAVING d > 0 ORDER BY d DESC, s.user_id ASC"
        return [(r["uid"], float(r["d"])) for r in self.db.query(sql, params)]

    def _baseline(self, journey_id: str, period: str) -> Dict[int, int]:
        """Ranks as of the start of today (for the delta arrows)."""
        start, end = self.window(period)
        midnight = iso(day_start_utc(self.stats.today(), self.stats.tz))
        if end is None or midnight < end:
            end = midnight
        if start is not None and start >= end:
            return {}
        return {uid: i + 1 for i, (uid, _) in enumerate(self.standings(journey_id, start, end))}

    def board(self, viewer_id: int, journey_id: str, period: str, limit: int = MAX_ROWS) -> dict:
        self.settle_weekly_podium()
        if self.library.get(journey_id) is None:
            raise WalkhomeError(f"unknown theme {journey_id!r}", 404, "unknown_theme")
        start, end = self.window(period)
        stand = self.standings(journey_id, start, end)
        before = self._baseline(journey_id, period)
        walking = self.profiles.walking_fn()
        rows = []
        me_rank = None
        for i, (uid, dist) in enumerate(stand):
            rank = i + 1
            if uid == viewer_id:
                me_rank = rank
            if rank > min(limit, MAX_ROWS):
                continue
            user = self.db.query_one("SELECT * FROM users WHERE id=?", (uid,))
            rows.append({
                "rank": rank,
                "profile": self.profiles.build(dict(user), walking),
                "distance_m": round(dist, 1),
                "delta_rank": (before[uid] - rank) if uid in before else 0,
                "is_me": uid == viewer_id,
                "gap_to_next_m": round(stand[i - 1][1] - dist, 1) if i > 0 else None,
            })
        return {
            "journey_id": journey_id, "period": period,
            "me_rank": me_rank, "total": len(stand), "rows": rows,
        }

    def ranks_brief(self, user_id: int, journey_id: str) -> dict:
        """{week, all, total} for the snapshot; cached a few seconds."""
        key = ("brief", journey_id)
        hit = self._cache.get(key)
        now = time.monotonic()
        if hit is None or now - hit[0] > self.cache_ttl_s:
            ws, we = self.window("week")
            hit = (now, [self.standings(journey_id, ws, we), self.standings(journey_id)])
            self._cache[key] = hit
        week, allt = hit[1]
        find = lambda lst: next(  # noqa: E731
            (i + 1 for i, (uid, _) in enumerate(lst) if uid == user_id), None)
        return {"week": find(week), "all": find(allt), "total": len(allt)}

    def invalidate(self) -> None:
        self._cache.clear()

    # -- overtakes ---------------------------------------------------------

    def _snapshot_key(self) -> str:
        return f"week:{week_key(self.stats.today())}"

    def _load_snapshot(self, journey_id: str) -> Dict[int, int]:
        rows = self.db.query(
            "SELECT user_id, rank FROM rank_snapshots WHERE journey_id=? AND period_key=?",
            (journey_id, self._snapshot_key()),
        )
        return {r["user_id"]: r["rank"] for r in rows}

    def _save_snapshot(self, journey_id: str, stand: List[Standing]) -> None:
        pkey, now = self._snapshot_key(), utcnow()
        with self.db.transaction():
            self.db.execute("DELETE FROM rank_snapshots WHERE journey_id=?", (journey_id,))
            for i, (uid, dist) in enumerate(stand):
                self.db.execute(
                    "INSERT INTO rank_snapshots(journey_id, period_key, user_id, rank, "
                    "distance_m, updated_utc) VALUES(?,?,?,?,?,?)",
                    (journey_id, pkey, uid, i + 1, dist, now),
                )

    def snapshot_baseline(self, journey_id: str) -> None:
        """Record the current weekly standings as 'what everyone last saw'."""
        ws, we = self.window("week")
        self._save_snapshot(journey_id, self.standings(journey_id, ws, we))

    def check_overtakes(self, user_id: int, journey_id: str) -> List[dict]:
        """Compare the live weekly standings with the last snapshot; pay and notify."""
        ws, we = self.window("week")
        stand = self.standings(journey_id, ws, we)
        previous = self._load_snapshot(journey_id)
        cur_rank = {uid: i + 1 for i, (uid, _) in enumerate(stand)}
        dist = dict(stand)
        events: List[dict] = []
        if previous and user_id in cur_rank:
            prev_me = previous.get(user_id, len(previous) + 1)
            for other, other_prev in sorted(previous.items(), key=lambda kv: kv[1]):
                if other == user_id or other not in cur_rank:
                    continue
                if (other_prev < prev_me and cur_rank[other] > cur_rank[user_id]
                        and dist[other] >= MIN_OVERTAKE_M):
                    events.append({"victim": other, "victim_prev": other_prev,
                                   "me_prev": prev_me})
        if stand != [] or previous:
            self._save_snapshot(journey_id, stand)
        self.invalidate()
        for ev in events:
            self._announce_overtake(user_id, ev, cur_rank, journey_id)
        return events

    def _announce_overtake(self, user_id: int, ev: dict, cur_rank: Dict[int, int],
                           journey_id: str) -> None:
        me = self.profiles.by_id(user_id)
        victim = self.profiles.by_id(ev["victim"])
        if not me or not victim:
            return
        day = self.stats.today()
        self.publish(user_id, "rank", {
            "journey_id": journey_id, "rank": cur_rank[user_id],
            "previous_rank": ev["me_prev"], "overtook": victim})
        self.publish(ev["victim"], "rank", {
            "journey_id": journey_id, "rank": cur_rank[ev["victim"]],
            "previous_rank": ev["victim_prev"], "overtaken_by": me})
        self.notifier.create(
            user_id, "rank_overtake", f"You overtook {victim['display_name']}",
            f"You are now {_ordinal(cur_rank[user_id])} this week.", "🏃",
            {"journey_id": journey_id, "user_id": ev["victim"], "url": "/leaderboard"},
            push=False)
        self.notifier.create(
            ev["victim"], "rank_overtake", f"{me['display_name']} overtook you",
            f"You are {_ordinal(cur_rank[ev['victim']])} this week. Your move!", "🏃",
            {"journey_id": journey_id, "user_id": user_id, "url": "/leaderboard"})
        grant = self.rewards.grant_overtake(user_id, ev["victim"], victim["display_name"], day)
        if grant:
            self.rewards.announce(user_id, [grant], "rank", grant["title"])

    # -- weekly podium -----------------------------------------------------

    def settle_weekly_podium(self) -> List[dict]:
        """Pay last week's podium, once, lazily (first call after Monday 00:00)."""
        today = self.stats.today()
        current = week_key(today)
        if self._podium_checked_for == current:
            return []
        prev_day = week_start_date(today) - timedelta(days=1)
        prev_wk = week_key(prev_day)
        start, end = (iso(x) for x in week_bounds_utc(prev_day, self.stats.tz))
        settled: List[dict] = []
        for journey_id in list(self.library.journeys):
            marker = f"podium:{journey_id}:{prev_wk}"
            if self.db.get_setting(marker):
                continue
            podium = [s for s in self.standings(journey_id, start, end)
                      if s[1] >= MIN_PODIUM_M][:3]
            granted: List[Tuple[int, int, List[dict]]] = []
            with self.db.transaction():
                self.db.set_setting(marker, utcnow())
                for place, (uid, dist) in enumerate(podium, start=1):
                    packs = PODIUM_PACKS[place]
                    gs = []
                    for i in range(packs):
                        key = f"{journey_id}:{prev_wk}:{place}" + (f"#{i + 1}" if i else "")
                        g = self.rewards.grant(uid, journey_id, "rank", key,
                                               f"Weekly podium: {_ordinal(place)} place")
                        if g:
                            gs.append(g)
                    self.db.execute(
                        "INSERT OR IGNORE INTO weekly_awards(week_key, journey_id, place, "
                        "user_id, distance_m, packs, created_utc) VALUES(?,?,?,?,?,?,?)",
                        (prev_wk, journey_id, place, uid, dist, packs, utcnow()))
                    granted.append((uid, place, gs))
            for uid, place, gs in granted:
                if not gs:
                    continue
                title = f"Weekly podium: {_ordinal(place)} place!"
                self.publish(uid, "reward", {"grants": gs, "reason": "weekly_podium",
                                             "title": title})
                self.notifier.create(
                    uid, "weekly_podium", title,
                    f"{len(gs)} pack{'s' if len(gs) > 1 else ''} awarded.",
                    "🏆", {"week": prev_wk, "place": place, "journey_id": journey_id,
                           "url": "/leaderboard"})
                settled.extend(gs)
        self._podium_checked_for = current
        return settled
