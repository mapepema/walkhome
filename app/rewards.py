"""The reward engine: who gets which pack, exactly once.

Every payout goes through :meth:`RewardEngine.grant`, which is an
``INSERT OR IGNORE`` on ``pack_grants(user_id, source, source_key)``. The engine
is therefore *derived and re-runnable*: ``evaluate`` can be called after every
checkpoint, on restart, or twice in a row, and only ever pays the delta.

Key conventions (``source_key``). Keys that would collide across themes carry a
``<theme>:`` prefix (event ids, for instance, are shared by all journey packs):

=========  =====================================================
distance   ``<theme>:<n>``       n-th ``pack_every_m`` threshold
daily      ``YYYY-MM-DD``        first km of the local day
streak     ``<N>``               3, 7, 14, 30, 60, 100 days
quest      ``<quest_id>:<period>``
milestone  ``<theme>:<event_id>``
album      ``<theme>:<set>:<25|50|75|100>``
rank       ``overtake:<victim_id>:<YYYY-MM-DD>`` /
           ``<theme>:<YYYY-Www>:<place>`` (weekly podium)
welcome    ``1`` and ``2``
=========  =====================================================
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Callable, Dict, List, Optional, Set

from .cards import CatalogStore, Collection, Wallet
from .config import Config
from .content import ContentLibrary
from .db import Database, utcnow
from .notifications import Notifier
from .stats import Stats
from .timeutil import Clock

log = logging.getLogger(__name__)

DEFAULT_PACK_EVERY_M = 2000.0
STREAK_TIERS = (3, 7, 14, 30, 60, 100)
ALBUM_TIERS = (25, 50, 75, 100)
DAILY_MIN_M = 1000.0
WELCOME_PACKS = 2
PODIUM_PACKS = {1: 3, 2: 2, 3: 1}
MAX_OVERTAKE_PACKS_PER_DAY = 3

Publish = Callable[[int, str, dict], None]


def grant_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "theme": row["theme"],
        "source": row["source"],
        "source_key": row["source_key"],
        "title": row["title"],
        "created_utc": row["created_utc"],
        "opened_utc": row["opened_utc"],
    }


def _fmt_km(meters: float) -> str:
    return f"{meters / 1000:.0f} km" if meters >= 10_000 else f"{meters / 1000:.1f} km"


class RewardEngine:
    def __init__(
        self,
        db: Database,
        library: ContentLibrary,
        store: CatalogStore,
        collection: Collection,
        wallet: Wallet,
        stats: Stats,
        cfg: Config,
        clock: Clock,
        notifier: Notifier,
        publish: Optional[Publish] = None,
        default_theme: str = "",
    ) -> None:
        self.db = db
        self.library = library
        self.store = store
        self.collection = collection
        self.wallet = wallet
        self.stats = stats
        self.cfg = cfg
        self.clock = clock
        self.notifier = notifier
        self.publish = publish or (lambda uid, t, d: None)
        self.default_theme = default_theme

    # -- primitives --------------------------------------------------------

    def pack_every_m(self, theme: str) -> float:
        journey = self.library.get(theme)
        rewards = (journey.data.get("rewards") if journey else None) or {}
        try:
            value = float(rewards.get("pack_every_m", DEFAULT_PACK_EVERY_M))
        except (TypeError, ValueError):
            value = DEFAULT_PACK_EVERY_M
        return value if value > 0 else DEFAULT_PACK_EVERY_M

    def user_theme(self, user_id: int) -> str:
        row = self.db.query_one("SELECT journey_id FROM users WHERE id=?", (user_id,))
        return (row["journey_id"] if row and row["journey_id"] else self.default_theme)

    def grant(
        self, user_id: int, theme: str, source: str, key: str, title: str
    ) -> Optional[dict]:
        """Idempotent payout. Returns the new grant, or None if already paid."""
        cur = self.db.execute(
            "INSERT OR IGNORE INTO pack_grants(user_id, theme, source, source_key, title, "
            "created_utc) VALUES(?,?,?,?,?,?)",
            (user_id, theme, source, key, title, utcnow()),
        )
        if cur.rowcount == 0:
            return None
        row = self.db.query_one("SELECT * FROM pack_grants WHERE id=?", (cur.lastrowid,))
        return grant_to_dict(row)

    def _existing_keys(self, user_id: int, source: str, prefix: str = "") -> Set[str]:
        rows = self.db.query(
            "SELECT source_key FROM pack_grants WHERE user_id=? AND source=? "
            "AND source_key LIKE ?",
            (user_id, source, prefix + "%"),
        )
        return {r["source_key"] for r in rows}

    # -- listings ----------------------------------------------------------

    def unopened(self, user_id: int) -> List[dict]:
        rows = self.db.query(
            "SELECT * FROM pack_grants WHERE user_id=? AND opened_utc IS NULL ORDER BY id",
            (user_id,),
        )
        return [grant_to_dict(r) for r in rows]

    def unopened_count(self, user_id: int) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM pack_grants WHERE user_id=? AND opened_utc IS NULL",
            (user_id,),
        )
        return int(row["n"])

    def opened_count(self, user_id: int) -> int:
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM pack_grants WHERE user_id=? AND opened_utc IS NOT NULL",
            (user_id,),
        )
        return int(row["n"])

    def packs_view(self, user_id: int) -> dict:
        theme = self.user_theme(user_id)
        every = self.pack_every_m(theme)
        done = self.stats.reward_m_by_theme(user_id).get(theme, 0.0)
        return {
            "unopened": self.unopened(user_id),
            "opened_count": self.opened_count(user_id),
            "next_pack_in_m": round(every - (done % every), 1),
            "pack_every_m": every,
        }

    def packs_brief(self, user_id: int) -> dict:
        view = self.packs_view(user_id)
        return {
            "unopened": len(view["unopened"]),
            "next_pack_in_m": view["next_pack_in_m"],
            "pack_every_m": view["pack_every_m"],
        }

    # -- announcements -----------------------------------------------------

    def announce(
        self,
        user_id: int,
        grants: List[dict],
        reason: str,
        title: str = "",
        notify: bool = True,
    ) -> None:
        if not grants:
            return
        heading = title or (
            grants[0]["title"] if len(grants) == 1 else f"{len(grants)} new packs"
        )
        self.publish(user_id, "reward", {"grants": grants, "reason": reason, "title": heading})
        if notify:
            kind = "milestone" if reason == "milestone" else "pack"
            self.notifier.create(
                user_id,
                kind,
                heading,
                "Open it from your packs." if len(grants) == 1
                else "Open them from your packs.",
                "🎁",
                {"grant_ids": [g["id"] for g in grants], "reason": reason, "url": "/packs"},
            )

    def _announce_grouped(self, user_id: int, grants: List[dict]) -> None:
        by_source: Dict[str, List[dict]] = {}
        for g in grants:
            by_source.setdefault(g["source"], []).append(g)
        for source, group in by_source.items():
            self.announce(user_id, group, source)

    # -- the derived engine ------------------------------------------------

    def evaluate(self, user_id: int, announce: bool = True) -> List[dict]:
        """Pay everything the user's history currently entitles them to."""
        user = self.db.query_one("SELECT id, journey_id FROM users WHERE id=?", (user_id,))
        if user is None:
            return []
        theme_now = user["journey_id"] or self.default_theme
        new: List[dict] = []

        # 1. distance: one pack per pack_every_m of rewardable distance, per theme
        for theme, meters in self.stats.reward_m_by_theme(user_id).items():
            if self.library.get(theme) is None:
                continue
            thresholds = int(meters // self.pack_every_m(theme))
            if thresholds <= 0:
                continue
            have = self._existing_keys(user_id, "distance", f"{theme}:")
            every = self.pack_every_m(theme)
            for n in range(1, thresholds + 1):
                key = f"{theme}:{n}"
                if key in have:
                    continue
                g = self.grant(
                    user_id, theme, "distance", key,
                    f"Distance: {_fmt_km(n * every)} walked",
                )
                if g:
                    new.append(g)

        # 2. daily: first kilometre of the (local) day -- today only
        today = self.stats.today()
        if self.stats.reward_m_by_day(user_id).get(today, 0.0) >= DAILY_MIN_M:
            g = self.grant(user_id, theme_now, "daily", today.isoformat(),
                           "First kilometre of the day")
            if g:
                new.append(g)

        # 3. streak tiers
        streak_days = self.stats.streak(user_id)["days"]
        for tier in STREAK_TIERS:
            if streak_days >= tier:
                g = self.grant(user_id, theme_now, "streak", str(tier),
                               f"{tier}-day streak")
                if g:
                    new.append(g)

        # 4. milestones crossed in a journey
        rows = self.db.query(
            "SELECT journey_id, event_id FROM fired_events "
            "WHERE subject_kind='user' AND subject_id=?",
            (user_id,),
        )
        for r in rows:
            journey = self.library.get(r["journey_id"])
            event = journey.event(r["event_id"]) if journey else None
            if event and event.get("kind") == "milestone":
                g = self.grant(user_id, journey.id, "milestone",
                               f"{journey.id}:{event['id']}", f"Milestone: {event['title']}")
                if g:
                    new.append(g)

        if announce and new:
            self._announce_grouped(user_id, new)
        return new

    def grant_welcome(self, user_id: int) -> List[dict]:
        theme = self.user_theme(user_id)
        out = []
        for i in range(1, WELCOME_PACKS + 1):
            g = self.grant(user_id, theme, "welcome", str(i), "Welcome pack")
            if g:
                out.append(g)
        return out

    def grant_overtake(
        self, user_id: int, victim_id: int, victim_name: str, day: date
    ) -> Optional[dict]:
        """Overtake reward, at most MAX_OVERTAKE_PACKS_PER_DAY per local day."""
        like = f"overtake:%:{day.isoformat()}"
        row = self.db.query_one(
            "SELECT COUNT(*) AS n FROM pack_grants WHERE user_id=? AND source='rank' "
            "AND source_key LIKE ?",
            (user_id, like),
        )
        if row["n"] >= MAX_OVERTAKE_PACKS_PER_DAY:
            return None
        return self.grant(
            user_id, self.user_theme(user_id), "rank",
            f"overtake:{victim_id}:{day.isoformat()}", f"You overtook {victim_name}",
        )

    # -- albums & pack opening ---------------------------------------------

    def check_album(self, user_id: int, theme: str) -> List[dict]:
        catalog = self.store.get(theme)
        if catalog is None:
            return []
        names = {s.get("id"): s.get("name") for s in catalog.data.get("sets", [])}
        new: List[dict] = []
        for set_id, (owned, total) in self.collection.set_progress(user_id, catalog).items():
            if total <= 0:
                continue
            pct = owned * 100 // total
            for tier in ALBUM_TIERS:
                if pct >= tier:
                    g = self.grant(
                        user_id, theme, "album", f"{theme}:{set_id}:{tier}",
                        f"Album \u201c{names.get(set_id) or set_id}\u201d at {tier}%",
                    )
                    if g:
                        new.append(g)
        if new:
            self._announce_grouped(user_id, new)
        return new

    def open_pack(self, user_id: int, grant_id: int) -> dict:
        result = self.collection.open_grant(user_id, grant_id)
        result["granted"] = self.check_album(user_id, result["theme"])
        return result

    def craft(self, user_id: int, card_id: str) -> dict:
        result = self.collection.craft(user_id, card_id)
        result["granted"] = self.check_album(user_id, result["card"].get("theme")
                                             or card_id.split(":", 1)[0])
        return result
