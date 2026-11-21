"""Daily / weekly / story quests.

Progress is *derived* from the tables that already exist (sessions, challenge
results, pack grants, fired events); the only stored thing is the claim
(``quest_claims``), which is what keeps a reward from being paid twice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

from .cards import Wallet
from .config import Config
from .content import ContentLibrary
from .db import Database, utcnow
from .errors import Conflict, NotFound, WalkhomeError
from .rewards import RewardEngine
from .stats import Stats
from .timeutil import (
    Clock, day_bounds_utc, iso, week_bounds_utc, week_key,
)

PACE_KMH = 4.5          # "steady pace"
PACE_HOLD_S = 600       # ...held for 10 minutes in one walk


@dataclass(frozen=True)
class QuestDef:
    id: str
    period: str          # daily | weekly
    icon: str
    title: str
    description: str
    target: float
    unit: str            # m | count | days | s
    reward: Dict[str, int] = field(default_factory=dict)


DAILY = (
    QuestDef("d_walk_2km", "daily", "🚶", "Two kilometres",
             "Walk 2 km today.", 2000, "m", {"packs": 1}),
    QuestDef("d_pace", "daily", "⏱️", "Steady pace",
             f"Hold {PACE_KMH:g} km/h or faster for 10 minutes in one go.",
             PACE_HOLD_S, "s", {"essence": 25}),
    QuestDef("d_challenge", "daily", "🏅", "Take on a challenge",
             "Complete a challenge during a walk.", 1, "count", {"essence": 40}),
)
WEEKLY = (
    QuestDef("w_5km_x3", "weekly", "📅", "Consistency",
             "Walk at least 5 km on three days this week.", 3, "days", {"packs": 1}),
    QuestDef("w_15km", "weekly", "🛣️", "Fifteen kilometres",
             "Walk 15 km in total this week.", 15000, "m", {"packs": 1, "essence": 30}),
    QuestDef("w_open_5", "weekly", "🎁", "Pack opener",
             "Open 5 packs this week.", 5, "count", {"essence": 60}),
    QuestDef("w_milestone", "weekly", "🏔️", "A milestone reached",
             "Reach a milestone of your journey this week.", 1, "count", {"packs": 1}),
)
CATALOG: Dict[str, QuestDef] = {q.id: q for q in DAILY + WEEKLY}
STORY_REWARD = {"packs": 1}


class QuestEngine:
    def __init__(
        self,
        db: Database,
        library: ContentLibrary,
        stats: Stats,
        rewards: RewardEngine,
        wallet: Wallet,
        cfg: Config,
        clock: Clock,
        progress_fn: Callable[[int, str], float],
    ) -> None:
        self.progress_m = progress_fn
        self.db = db
        self.library = library
        self.stats = stats
        self.rewards = rewards
        self.wallet = wallet
        self.cfg = cfg
        self.clock = clock

    # -- helpers -----------------------------------------------------------

    def _claimed(self, user_id: int) -> set:
        rows = self.db.query(
            "SELECT quest_id, period_key FROM quest_claims WHERE user_id=?", (user_id,)
        )
        return {(r["quest_id"], r["period_key"]) for r in rows}

    def _windows(self):
        tz = self.stats.tz
        today = self.stats.today()
        d0, d1 = day_bounds_utc(today, tz)
        w0, w1 = week_bounds_utc(today, tz)
        return today, (iso(d0), iso(d1)), (iso(w0), iso(w1)), week_key(today)

    def _count(self, sql: str, params: tuple) -> int:
        row = self.db.query_one(sql, params)
        return int(row["n"]) if row else 0

    def _milestones_fired(self, user_id: int, since: str, until: str) -> int:
        rows = self.db.query(
            "SELECT journey_id, event_id FROM fired_events WHERE subject_kind='user' "
            "AND subject_id=? AND fired_utc >= ? AND fired_utc < ?",
            (user_id, since, until),
        )
        n = 0
        for r in rows:
            journey = self.library.get(r["journey_id"])
            event = journey.event(r["event_id"]) if journey else None
            if event and event.get("kind") == "milestone":
                n += 1
        return n

    def _progress(self, user_id: int, q: QuestDef, ctx: dict) -> float:
        by_day = ctx["by_day"]
        if q.id == "d_walk_2km":
            return by_day.get(ctx["today"], 0.0)
        if q.id == "d_pace":
            d0, d1 = ctx["day_win"]
            rows = self.db.query(
                "SELECT moving_s, distance_m FROM sessions WHERE user_id=? AND source!='manual' "
                "AND start_utc >= ? AND start_utc < ?",
                (user_id, d0, d1),
            )
            best = 0.0
            for r in rows:
                moving = float(r["moving_s"] or 0)
                if moving > 0 and float(r["distance_m"]) / moving * 3.6 >= PACE_KMH:
                    best = max(best, moving)
            return best
        if q.id == "d_challenge":
            d0, d1 = ctx["day_win"]
            return self._count(
                "SELECT COUNT(*) AS n FROM challenge_results WHERE user_id=? AND succeeded=1 "
                "AND created_utc >= ? AND created_utc < ?", (user_id, d0, d1))
        week_days = {d: m for d, m in by_day.items() if week_key(d) == ctx["week"]}
        if q.id == "w_5km_x3":
            return float(sum(1 for m in week_days.values() if m >= 5000))
        if q.id == "w_15km":
            return float(sum(week_days.values()))
        if q.id == "w_open_5":
            w0, w1 = ctx["week_win"]
            return self._count(
                "SELECT COUNT(*) AS n FROM pack_grants WHERE user_id=? AND opened_utc >= ? "
                "AND opened_utc < ?", (user_id, w0, w1))
        if q.id == "w_milestone":
            w0, w1 = ctx["week_win"]
            return float(self._milestones_fired(user_id, w0, w1))
        return 0.0

    # -- public ------------------------------------------------------------

    def list(self, user_id: int) -> List[dict]:
        today, day_win, week_win, wk = self._windows()
        ctx = {
            "today": today, "day_win": day_win, "week_win": week_win, "week": wk,
            "by_day": self.stats.reward_m_by_day(user_id),
        }
        claimed = self._claimed(user_id)
        out: List[dict] = []
        for q in DAILY + WEEKLY:
            period_key = today.isoformat() if q.period == "daily" else wk
            progress = min(self._progress(user_id, q, ctx), q.target)
            done = progress >= q.target
            is_claimed = (q.id, period_key) in claimed
            out.append(self._view(q.id, q, progress, done, is_claimed,
                                  day_win[1] if q.period == "daily" else week_win[1]))
        story = self._story(user_id, claimed)
        if story:
            out.append(story)
        return out

    def _story_candidate(self, user_id: int, claimed: set):
        row = self.db.query_one("SELECT journey_id FROM users WHERE id=?", (user_id,))
        journey = self.library.get(row["journey_id"]) if row and row["journey_id"] else None
        if journey is None:
            return None
        for event in journey.events:
            if event.get("kind") != "milestone" or event["at_m"] <= 0:
                continue
            qid = f"story:{journey.id}:{event['id']}"
            if (qid, "story") not in claimed:
                return journey, event, qid
        return None

    def _story(self, user_id: int, claimed: set) -> Optional[dict]:
        found = self._story_candidate(user_id, claimed)
        if not found:
            return None
        journey, event, qid = found
        progress = min(self.progress_m(user_id, journey.id), event["at_m"])
        q = QuestDef(qid, "story", event.get("icon") or "🧭", f"Reach: {event['title']}",
                     "A milestone of your journey is waiting.", event["at_m"], "m", STORY_REWARD)
        return self._view(qid, q, progress, progress >= q.target, False, None)

    @staticmethod
    def _view(qid: str, q: QuestDef, progress: float, done: bool, claimed: bool,
              expires: Optional[str]) -> dict:
        return {
            "id": qid, "period": q.period, "icon": q.icon, "title": q.title,
            "description": q.description, "target": q.target,
            "progress": round(progress, 1), "unit": q.unit, "reward": dict(q.reward),
            "claimable": done and not claimed, "claimed": claimed, "expires_utc": expires,
        }

    def claim(self, user_id: int, quest_id: str) -> dict:
        quests = {q["id"]: q for q in self.list(user_id)}
        quest = quests.get(quest_id)
        if quest is None:
            raise NotFound("unknown quest", "quest_not_found")
        if quest["claimed"]:
            raise Conflict("quest already claimed", "quest_already_claimed")
        if not quest["claimable"]:
            raise WalkhomeError("quest not complete yet", 400, "quest_not_complete")
        period = quest["period"]
        today = self.stats.today()
        period_key = {"daily": today.isoformat(), "weekly": week_key(today)}.get(period, "story")
        reward = quest["reward"]
        theme = self.rewards.user_theme(user_id)
        granted: List[dict] = []
        gained = int(reward.get("essence", 0))
        with self.db.transaction():
            cur = self.db.execute(
                "INSERT OR IGNORE INTO quest_claims(user_id, quest_id, period_key, claimed_utc) "
                "VALUES(?,?,?,?)", (user_id, quest_id, period_key, utcnow()))
            if cur.rowcount == 0:
                raise Conflict("quest already claimed", "quest_already_claimed")
            for i in range(int(reward.get("packs", 0))):
                key = f"{quest_id}:{period_key}" + (f"#{i + 1}" if i else "")
                g = self.rewards.grant(user_id, theme, "quest", key, quest["title"])
                if g:
                    granted.append(g)
            balance = self.wallet.add(user_id, gained) if gained else self.wallet.essence(user_id)
        if granted:
            self.rewards.announce(user_id, granted, "quest", quest["title"], notify=False)
        return {"granted": granted, "essence": balance, "essence_gained": gained}
