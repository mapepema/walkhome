"""Card catalogs, the server-side pack draw, the collection and the wallet.

The server rolls the cards (anti-cheat); clients only animate the result. The
RNG is injectable so tests can seed it, and production uses ``SystemRandom``.

Catalogs are *data*: ``content/cards/<theme>.json`` (produced by the assets
pipeline, schema ``CardCatalog`` in docs/CONTRACT.md). A theme without a catalog
simply cannot be drawn from yet -- nothing else breaks.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .db import Database, utcnow
from .errors import Conflict, NotFound, WalkhomeError

log = logging.getLogger(__name__)

RARITIES = ("common", "uncommon", "rare", "holo", "ultra", "secret")
RARITY_RANK = {r: i for i, r in enumerate(RARITIES)}

# Essence a duplicate is worth.
DUP_ESSENCE: Dict[str, int] = {
    "common": 5, "uncommon": 10, "rare": 25, "holo": 60, "ultra": 150, "secret": 400,
}
# Crafting a missing card costs 4x its duplicate value; secrets cannot be crafted.
CRAFT_MULTIPLIER = 4
CRAFT_COST: Dict[str, Optional[int]] = {
    r: (None if r == "secret" else DUP_ESSENCE[r] * CRAFT_MULTIPLIER) for r in RARITIES
}

DEFAULT_PACK: Dict[str, Any] = {
    "cards_per_pack": 5,
    "slots": [
        {"label": "common", "odds": {"common": 70, "uncommon": 30}},
        {"label": "common", "odds": {"common": 70, "uncommon": 30}},
        {"label": "common", "odds": {"common": 70, "uncommon": 30}},
        {"label": "rare", "odds": {"rare": 85, "holo": 12, "ultra": 2.8, "secret": 0.2}},
        {"label": "chance", "odds": {"uncommon": 40, "rare": 40, "holo": 15,
                                     "ultra": 4.5, "secret": 0.5}},
    ],
    "pity": {"rare_every": 5, "ultra_every": 25},
}
CHANCE_ODDS = DEFAULT_PACK["slots"][-1]["odds"]


# --------------------------------------------------------------------------
# catalogs
# --------------------------------------------------------------------------

class Catalog:
    """A parsed ``CardCatalog`` with lookups by id, set and rarity."""

    def __init__(self, theme: str, data: Dict[str, Any], etag: str) -> None:
        self.theme = theme
        self.data = data
        self.etag = etag
        self.cards: List[dict] = [
            c for c in data.get("cards", []) if c.get("rarity") in RARITY_RANK and c.get("id")
        ]
        self.by_id: Dict[str, dict] = {c["id"]: c for c in self.cards}
        self.by_rarity: Dict[str, List[dict]] = {r: [] for r in RARITIES}
        self.by_set: Dict[str, List[dict]] = {}
        for c in self.cards:
            self.by_rarity[c["rarity"]].append(c)
            self.by_set.setdefault(c.get("set", ""), []).append(c)
        pack = {**DEFAULT_PACK, **(data.get("pack") or {})}
        pity = {**DEFAULT_PACK["pity"], **(pack.get("pity") or {})}
        slots = pack.get("slots") or DEFAULT_PACK["slots"]
        count = int(pack.get("cards_per_pack") or 5)
        if len(slots) != count:
            slots = DEFAULT_PACK["slots"]
            count = len(slots)
        self.pack = {"cards_per_pack": count, "slots": slots, "pity": pity}

    @property
    def usable(self) -> bool:
        return bool(self.cards)

    def available(self) -> Dict[str, bool]:
        return {r: bool(self.by_rarity[r]) for r in RARITIES}

    def set_total(self, set_id: str) -> int:
        return len(self.by_set.get(set_id, []))


class CatalogStore:
    """Loads ``content/cards/<theme>.json`` lazily and re-reads it when it changes."""

    def __init__(self, content_dir: Path) -> None:
        self.dir = Path(content_dir) / "cards"
        self._cache: Dict[str, Tuple[float, Optional[Catalog]]] = {}

    def get(self, theme: str) -> Optional[Catalog]:
        if not theme or "/" in theme or ".." in theme:
            return None
        path = self.dir / f"{theme}.json"
        try:
            mtime = path.stat().st_mtime
        except OSError:
            self._cache.pop(theme, None)
            return None
        cached = self._cache.get(theme)
        if cached and cached[0] == mtime:
            return cached[1]
        catalog: Optional[Catalog] = None
        try:
            raw = path.read_bytes()
            data = json.loads(raw.decode("utf-8"))
            catalog = Catalog(theme, data, hashlib.sha1(raw).hexdigest())
            if not catalog.usable:
                catalog = None
        except (OSError, ValueError) as exc:
            log.warning("card catalog %s unreadable: %s", path.name, exc)
        self._cache[theme] = (mtime, catalog)
        return catalog

    def card_count(self, theme: str) -> int:
        cat = self.get(theme)
        return len(cat.cards) if cat else 0

    def find_card(self, card_id: str) -> Optional[dict]:
        theme = card_id.split(":", 1)[0]
        cat = self.get(theme)
        return cat.by_id.get(card_id) if cat else None


# --------------------------------------------------------------------------
# the draw (pure)
# --------------------------------------------------------------------------

@dataclass
class Pity:
    since_rare: int = 0
    since_ultra: int = 0
    opened: int = 0

    def as_dict(self, rare_every: int, ultra_every: int) -> dict:
        return {
            "since_rare": self.since_rare, "since_ultra": self.since_ultra,
            "opened": self.opened, "rare_every": rare_every, "ultra_every": ultra_every,
        }


def _pick_rarity(
    odds: Dict[str, float], rng: random.Random, available: Dict[str, bool], min_rank: int = 0
) -> str:
    def usable(table: Dict[str, float]) -> Dict[str, float]:
        return {
            r: float(w) for r, w in table.items()
            if r in RARITY_RANK and RARITY_RANK[r] >= min_rank and available.get(r) and w > 0
        }

    weights = usable(odds)
    if not weights and min_rank > 0:
        weights = usable(CHANCE_ODDS)
    if not weights:
        # Nothing matches (e.g. a tiny catalog): take the closest rarity that exists.
        existing = [r for r in RARITIES if available.get(r)]
        at_least = [r for r in existing if RARITY_RANK[r] >= min_rank]
        return at_least[0] if at_least else existing[-1]
    names = list(weights)
    return rng.choices(names, weights=[weights[n] for n in names])[0]


def draw_pack(
    catalog: Catalog, rng: random.Random, pity: Pity
) -> Tuple[List[dict], Pity]:
    """Roll one pack. Returns (cards, updated pity). Pure given the RNG."""
    avail = catalog.available()
    slots = catalog.pack["slots"]
    rare_every = int(catalog.pack["pity"]["rare_every"])
    ultra_every = int(catalog.pack["pity"]["ultra_every"])

    def roll(odds: Dict[str, float], taken: List[dict], min_rank: int = 0) -> dict:
        # The rarity follows the slot's odds; the *card* is then picked among
        # that rarity's cards not already in the pack, so avoiding in-pack
        # duplicates never skews the published odds.
        rarity = _pick_rarity(odds, rng, avail, min_rank)
        pool = catalog.by_rarity[rarity]
        taken_ids = {t["id"] for t in taken}
        fresh = [c for c in pool if c["id"] not in taken_ids]
        return rng.choice(fresh or pool)

    cards: List[dict] = []
    for slot in slots:
        cards.append(roll(slot.get("odds") or CHANCE_ODDS, cards))

    best = max(RARITY_RANK[c["rarity"]] for c in cards)
    need_ultra = pity.since_ultra + 1 >= ultra_every and best < RARITY_RANK["ultra"]
    need_rare = pity.since_rare + 1 >= rare_every and best < RARITY_RANK["rare"]
    if need_ultra or need_rare:
        floor = RARITY_RANK["ultra" if need_ultra else "rare"]
        last_odds = slots[-1].get("odds") or CHANCE_ODDS
        cards[-1] = roll(last_odds, cards[:-1], min_rank=floor)
        best = max(RARITY_RANK[c["rarity"]] for c in cards)

    updated = Pity(
        since_rare=0 if best >= RARITY_RANK["rare"] else pity.since_rare + 1,
        since_ultra=0 if best >= RARITY_RANK["ultra"] else pity.since_ultra + 1,
        opened=pity.opened + 1,
    )
    return cards, updated


# --------------------------------------------------------------------------
# wallet + collection (DB)
# --------------------------------------------------------------------------

class Wallet:
    def __init__(self, db: Database) -> None:
        self.db = db

    def essence(self, user_id: int) -> int:
        row = self.db.query_one("SELECT essence FROM wallet WHERE user_id=?", (user_id,))
        return int(row["essence"]) if row else 0

    def add(self, user_id: int, amount: int) -> int:
        self.db.execute(
            "INSERT INTO wallet(user_id, essence) VALUES(?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET essence = essence + excluded.essence",
            (user_id, int(amount)),
        )
        return self.essence(user_id)


class Collection:
    """A player's cards, plus the open/craft operations that change them."""

    def __init__(self, db: Database, store: CatalogStore, wallet: Wallet, rng: random.Random):
        self.db = db
        self.store = store
        self.wallet = wallet
        self.rng = rng

    def owned(self, user_id: int, theme: Optional[str] = None) -> Dict[str, dict]:
        sql = "SELECT card_id, count, first_utc FROM collection WHERE user_id=?"
        params: list = [user_id]
        if theme:
            sql += " AND theme=?"
            params.append(theme)
        return {
            r["card_id"]: {"count": r["count"], "first_utc": r["first_utc"]}
            for r in self.db.query(sql, params)
        }

    def view(self, user_id: int, theme: str) -> dict:
        owned = self.owned(user_id, theme)
        catalog = self.store.get(theme)
        completion: Dict[str, dict] = {}
        if catalog:
            for set_id, cards in catalog.by_set.items():
                completion[set_id] = {
                    "owned": sum(1 for c in cards if c["id"] in owned),
                    "total": len(cards),
                }
        return {
            "theme": theme,
            "owned": owned,
            "completion": completion,
            "essence": self.wallet.essence(user_id),
        }

    def set_progress(self, user_id: int, catalog: Catalog) -> Dict[str, Tuple[int, int]]:
        owned = self.owned(user_id, catalog.theme)
        return {
            set_id: (sum(1 for c in cards if c["id"] in owned), len(cards))
            for set_id, cards in catalog.by_set.items()
        }

    def counts(self, user_id: int, theme: str) -> Tuple[int, int]:
        """(distinct cards owned, cards in the catalog) for a theme."""
        owned = len(self.owned(user_id, theme))
        return owned, self.store.card_count(theme)

    def best_cards(self, user_id: int, theme: str, limit: int = 5) -> List[dict]:
        catalog = self.store.get(theme)
        if not catalog:
            return []
        rows = self.db.query(
            "SELECT card_id FROM collection WHERE user_id=? AND theme=? ORDER BY first_utc DESC",
            (user_id, theme),
        )
        cards = [catalog.by_id[r["card_id"]] for r in rows if r["card_id"] in catalog.by_id]
        cards.sort(key=lambda c: -RARITY_RANK[c["rarity"]])  # stable: newest first per tier
        return cards[:limit]

    def best_rarity(self, user_id: int, theme: str) -> Optional[str]:
        best = self.best_cards(user_id, theme, 1)
        return best[0]["rarity"] if best else None

    # -- pity ---------------------------------------------------------------

    def pity(self, user_id: int, theme: str) -> Pity:
        row = self.db.query_one(
            "SELECT since_rare, since_ultra, opened FROM pity WHERE user_id=? AND theme=?",
            (user_id, theme),
        )
        return Pity(row["since_rare"], row["since_ultra"], row["opened"]) if row else Pity()

    def _save_pity(self, user_id: int, theme: str, p: Pity) -> None:
        self.db.execute(
            "INSERT INTO pity(user_id, theme, since_rare, since_ultra, opened) "
            "VALUES(?,?,?,?,?) ON CONFLICT(user_id, theme) DO UPDATE SET "
            "since_rare=excluded.since_rare, since_ultra=excluded.since_ultra, "
            "opened=excluded.opened",
            (user_id, theme, p.since_rare, p.since_ultra, p.opened),
        )

    # -- operations ---------------------------------------------------------

    def open_grant(self, user_id: int, grant_id: int) -> dict:
        """Open one of *this user's* unopened packs. Atomic and single-use."""
        with self.db.transaction():
            grant = self.db.query_one(
                "SELECT * FROM pack_grants WHERE id=? AND user_id=?", (grant_id, user_id)
            )
            if grant is None:
                raise NotFound("unknown pack", "pack_not_found")
            if grant["opened_utc"] is not None:
                raise Conflict("pack already opened", "pack_already_opened")
            theme = grant["theme"]
            catalog = self.store.get(theme)
            if catalog is None:
                raise NotFound(
                    f"no card catalog for theme {theme!r} yet", "catalog_unavailable"
                )
            now = utcnow()
            self.db.execute(
                "UPDATE pack_grants SET opened_utc=? WHERE id=?", (now, grant_id)
            )
            cards, pity = draw_pack(catalog, self.rng, self.pity(user_id, theme))
            self._save_pity(user_id, theme, pity)
            results = []
            essence_total = 0
            for card in cards:
                existing = self.db.query_one(
                    "SELECT count FROM collection WHERE user_id=? AND card_id=?",
                    (user_id, card["id"]),
                )
                if existing is None:
                    self.db.execute(
                        "INSERT INTO collection(user_id, card_id, theme, count, first_utc) "
                        "VALUES(?,?,?,?,?)",
                        (user_id, card["id"], theme, 1, now),
                    )
                    count, gained, is_new = 1, 0, True
                else:
                    count = existing["count"] + 1
                    gained = DUP_ESSENCE[card["rarity"]]
                    self.db.execute(
                        "UPDATE collection SET count=? WHERE user_id=? AND card_id=?",
                        (count, user_id, card["id"]),
                    )
                    is_new = False
                essence_total += gained
                results.append(
                    {"card": card, "is_new": is_new, "count": count, "essence_gained": gained}
                )
            essence = self.wallet.add(user_id, essence_total) if essence_total else (
                self.wallet.essence(user_id)
            )
        return {
            "pack_id": grant_id,
            "theme": theme,
            "cards": results,
            "pity": pity.as_dict(
                int(catalog.pack["pity"]["rare_every"]), int(catalog.pack["pity"]["ultra_every"])
            ),
            "essence": essence,
        }

    def craft(self, user_id: int, card_id: str) -> dict:
        card = self.store.find_card(card_id)
        if card is None:
            raise NotFound("unknown card", "card_not_found")
        cost = CRAFT_COST[card["rarity"]]
        if cost is None:
            raise WalkhomeError("this card cannot be crafted", 400, "not_craftable")
        with self.db.transaction():
            if self.db.query_one(
                "SELECT 1 FROM collection WHERE user_id=? AND card_id=?", (user_id, card_id)
            ):
                raise Conflict("you already own this card", "already_owned")
            if self.wallet.essence(user_id) < cost:
                raise WalkhomeError("not enough essence", 400, "not_enough_essence")
            self.wallet.add(user_id, -cost)
            self.db.execute(
                "INSERT INTO collection(user_id, card_id, theme, count, first_utc) "
                "VALUES(?,?,?,?,?)",
                (user_id, card_id, card.get("theme") or card_id.split(":", 1)[0], 1, utcnow()),
            )
        return {
            "card_id": card_id, "card": card, "cost": cost,
            "essence": self.wallet.essence(user_id),
        }

    def economy(self) -> dict:
        return {
            "dup_essence": dict(DUP_ESSENCE),
            "craft_cost": dict(CRAFT_COST),
            "rarities": list(RARITIES),
        }
