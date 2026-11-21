"""Derived statistics: reward-eligible distance, daily totals, streaks.

Nothing here is stored. "Reward distance" is the walked distance the reward
engine is willing to pay for: treadmill sessions count in full, manual entries
are capped (anti-cheat, see ``rewardable_manual_m``).
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from .config import Config
from .db import Database
from .timeutil import Clock, get_tz, local_date, parse_utc, week_key

# A day only counts for streaks/dailies once it holds a real walk.
STREAK_MIN_M = 100.0
# Manual entries above this implied speed are treated as implausible.
MANUAL_MAX_SPEED_KMH = 12.0
MANUAL_IMPLAUSIBLE_CAP_M = 400.0


@dataclass
class RewardRow:
    session_id: int
    journey_id: str
    day: date
    source: str
    walked_m: float      # what the session recorded
    reward_m: float      # what the reward engine will count


def rewardable_manual_m(distance_m: float, elapsed_s: float, remaining_day_cap_m: float) -> float:
    """How much of a manual entry may earn rewards.

    * implied speed above 12 km/h (or no duration at all) => at most 400 m
    * then bounded by what is left of the per-day manual cap
    """
    eff = float(distance_m)
    if elapsed_s <= 0 or (distance_m / elapsed_s) * 3.6 > MANUAL_MAX_SPEED_KMH:
        eff = min(eff, MANUAL_IMPLAUSIBLE_CAP_M)
    return max(0.0, min(eff, remaining_day_cap_m))


class Stats:
    def __init__(self, db: Database, cfg: Config, clock: Clock) -> None:
        self.db = db
        self.cfg = cfg
        self.clock = clock
        self._rows_cache: Dict[int, tuple] = {}

    def invalidate(self, user_id: Optional[int] = None) -> None:
        if user_id is None:
            self._rows_cache.clear()
        else:
            self._rows_cache.pop(user_id, None)

    @property
    def tz(self):
        return get_tz(self.cfg.tz_name)

    def today(self) -> date:
        return local_date(self.clock(), self.tz)

    # -- reward distance ---------------------------------------------------

    def reward_rows(self, user_id: int) -> List[RewardRow]:
        ttl = self.cfg.stats_cache_ttl_s
        hit = self._rows_cache.get(user_id)
        if ttl > 0 and hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        out = self._compute_reward_rows(user_id)
        if ttl > 0:
            self._rows_cache[user_id] = (time.monotonic(), out)
        return out

    def _compute_reward_rows(self, user_id: int) -> List[RewardRow]:
        rows = self.db.query(
            "SELECT id, journey_id, source, start_utc, distance_m, elapsed_s "
            "FROM sessions WHERE user_id=? AND distance_m > 0 "
            "ORDER BY start_utc, id",
            (user_id,),
        )
        tz = self.tz
        manual_used: Dict[date, float] = defaultdict(float)
        out: List[RewardRow] = []
        for r in rows:
            start = parse_utc(r["start_utc"])
            if start is None:
                continue
            day = local_date(start, tz)
            walked = float(r["distance_m"])
            if r["source"] == "manual":
                remaining = self.cfg.manual_reward_cap_m - manual_used[day]
                eff = rewardable_manual_m(walked, float(r["elapsed_s"] or 0), remaining)
                manual_used[day] += eff
            else:
                eff = walked
            out.append(RewardRow(r["id"], r["journey_id"], day, r["source"], walked, eff))
        return out

    def reward_m_by_theme(self, user_id: int) -> Dict[str, float]:
        totals: Dict[str, float] = defaultdict(float)
        for row in self.reward_rows(user_id):
            totals[row.journey_id] += row.reward_m
        return dict(totals)

    def reward_m_by_day(self, user_id: int) -> Dict[date, float]:
        totals: Dict[date, float] = defaultdict(float)
        for row in self.reward_rows(user_id):
            totals[row.day] += row.reward_m
        return dict(totals)

    def reward_m_for_week(self, user_id: int, wk: str) -> Dict[date, float]:
        return {
            d: m for d, m in self.reward_m_by_day(user_id).items() if week_key(d) == wk
        }

    # -- history -----------------------------------------------------------

    def daily_totals(self, user_id: int, days: int = 30) -> List[dict]:
        """Raw walked distance per local day (what the user sees in their history)."""
        since = self.clock() - timedelta(days=days + 1)
        rows = self.db.query(
            "SELECT start_utc, distance_m FROM sessions WHERE user_id=? AND start_utc >= ?",
            (user_id, since.isoformat(timespec="seconds")),
        )
        tz = self.tz
        acc: Dict[date, List[float]] = defaultdict(lambda: [0.0, 0])
        for r in rows:
            start = parse_utc(r["start_utc"])
            if start is None:
                continue
            slot = acc[local_date(start, tz)]
            slot[0] += float(r["distance_m"] or 0)
            slot[1] += 1
        cutoff = self.today() - timedelta(days=days)
        return [
            {"day": d.isoformat(), "distance_m": v[0], "sessions": v[1]}
            for d, v in sorted(acc.items())
            if d >= cutoff
        ]

    def streak(self, user_id: int) -> dict:
        """A forgiving streak: one missed day is a grace day, not a reset.

        Guilt mechanics are exactly what the motivation research says to avoid,
        so this counts days walked and tolerates a gap rather than punishing it.
        """
        by_day = self.reward_m_by_day(user_id)
        days = sorted((d for d, m in by_day.items() if m >= STREAK_MIN_M), reverse=True)
        if not days:
            return {"days": 0, "grace_used": 0, "last_walk": None}
        today = self.today()
        if (today - days[0]).days > 1:
            return {"days": 0, "grace_used": 0, "last_walk": days[0].isoformat()}
        streak, grace, cursor = 1, 0, days[0]
        for day in days[1:]:
            gap = (cursor - day).days
            if gap == 1:
                streak += 1
            elif gap == 2 and grace == 0:
                streak += 1
                grace = 1
            else:
                break
            cursor = day
        return {"days": streak, "grace_used": grace, "last_walk": days[0].isoformat()}

    def recent_pace_m_per_day(self, user_id: int, days: int = 14) -> float:
        since = self.clock() - timedelta(days=days)
        row = self.db.query_one(
            "SELECT COALESCE(SUM(distance_m), 0) AS d FROM sessions "
            "WHERE user_id=? AND start_utc >= ?",
            (user_id, since.isoformat(timespec="seconds")),
        )
        return (float(row["d"]) if row else 0.0) / days
