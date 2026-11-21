"""Public profiles: the only view of another player the API ever exposes.

No session history, weight, heart rate or notes -- just progress, streak and
collection counts (docs/CONTRACT.md 2.3).
"""

from __future__ import annotations

from typing import Callable, Optional, Set

from .cards import Collection
from .content import ContentLibrary
from .db import Database
from .stats import Stats


class ProfileBuilder:
    def __init__(
        self,
        db: Database,
        library: ContentLibrary,
        stats: Stats,
        collection: Collection,
        progress_fn: Callable[[int, str], float],
        walking_fn: Callable[[], Set[int]],
    ) -> None:
        self.db = db
        self.library = library
        self.stats = stats
        self.collection = collection
        self.progress_fn = progress_fn
        self.walking_fn = walking_fn

    def build(self, user: dict, walking: Optional[Set[int]] = None) -> dict:
        journey_id = user.get("journey_id") or ""
        journey = self.library.get(journey_id)
        progress = self.progress_fn(user["id"], journey_id) if journey else 0.0
        stage = journey.stage_at(progress) if journey else None
        biome = journey.biome_at(progress) if journey else None
        owned, total = self.collection.counts(user["id"], journey_id)
        walking = self.walking_fn() if walking is None else walking
        return {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
            "avatar": user["avatar"],
            "color": user["color"],
            "journey_id": journey_id,
            "progress_m": round(progress, 1),
            "fraction": round(journey.progress_fraction(progress), 5) if journey else 0.0,
            "stage_name": stage["name"] if stage else None,
            "biome_name": biome["name"] if biome else None,
            "streak_days": self.stats.streak(user["id"])["days"],
            "cards_owned": owned,
            "cards_total": total,
            "walking_now": user["id"] in walking,
            "best_rarity": self.collection.best_rarity(user["id"], journey_id),
        }

    def by_id(self, user_id: int) -> Optional[dict]:
        row = self.db.query_one("SELECT * FROM users WHERE id=? AND archived=0", (user_id,))
        return self.build(dict(row)) if row else None
