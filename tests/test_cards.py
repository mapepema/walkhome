"""Server-side draw: odds, pity, duplicates -> essence, crafting, albums."""

import copy
import random
from collections import Counter

import pytest

from app.cards import (
    CRAFT_COST, DUP_ESSENCE, RARITY_RANK, Catalog, Pity, draw_pack,
)
from app.errors import Conflict, NotFound, WalkhomeError
from tests.conftest import build_catalog


def catalog(**mods):
    data = build_catalog("camino")
    data.update(mods)
    return Catalog("camino", data, "etag")


def open_all(env, uid, n):
    out = []
    for _ in range(n):
        g = env.svc.rewards.grant(uid, "camino", "test", f"k{random.random()}", "t")
        out.append(env.svc.rewards.open_pack(uid, g["id"]))
    return out


def test_pack_structure_and_slot_rules():
    cat, rng = catalog(), random.Random(7)
    for _ in range(300):
        cards, _ = draw_pack(cat, rng, Pity())
        assert len(cards) == 5
        # no in-pack duplicate unless the rarity pool is a single card
        multi = [c["id"] for c in cards if c["rarity"] not in ("ultra", "secret")]
        assert len(multi) == len(set(multi))
        assert all(c["rarity"] in ("common", "uncommon") for c in cards[:3])
        assert RARITY_RANK[cards[3]["rarity"]] >= RARITY_RANK["rare"]


def test_chance_slot_odds_are_respected():
    cat, rng = catalog(), random.Random(99)
    seen = Counter()
    n = 6000
    for _ in range(n):
        cards, _ = draw_pack(cat, rng, Pity())
        seen[cards[4]["rarity"]] += 1
    freq = {r: seen[r] / n for r in seen}
    assert freq.get("common", 0) == 0
    assert freq["uncommon"] == pytest.approx(0.40, abs=0.04)
    assert freq["rare"] == pytest.approx(0.40, abs=0.04)
    assert freq["holo"] == pytest.approx(0.15, abs=0.03)
    assert 0.02 < freq["ultra"] + freq.get("secret", 0) < 0.09


def test_rng_is_injectable_and_deterministic():
    cat = catalog()
    a = [c["id"] for c in draw_pack(cat, random.Random(5), Pity())[0]]
    b = [c["id"] for c in draw_pack(cat, random.Random(5), Pity())[0]]
    assert a == b


def stingy_catalog():
    data = build_catalog("camino")
    data["pack"]["slots"] = [{"label": "x", "odds": {"common": 1}}] * 5
    return Catalog("camino", data, "e")


def test_rare_pity_guarantees_a_rare_every_5_opens():
    cat, rng, pity = stingy_catalog(), random.Random(3), Pity()
    best = []
    for _ in range(10):
        cards, pity = draw_pack(cat, rng, pity)
        best.append(max(RARITY_RANK[c["rarity"]] for c in cards))
    assert [b >= RARITY_RANK["rare"] for b in best] == [False] * 4 + [True] + [False] * 4 + [True]


def test_ultra_pity_every_25_opens():
    cat, rng, pity = stingy_catalog(), random.Random(11), Pity()
    ultra_at = []
    for i in range(1, 51):
        cards, pity = draw_pack(cat, rng, pity)
        if max(RARITY_RANK[c["rarity"]] for c in cards) >= RARITY_RANK["ultra"]:
            ultra_at.append(i)
    assert ultra_at == [25, 50]


def test_pity_state_is_persisted_in_the_database(env):
    u = env.user("pity1")
    env.svc.store._cache.clear()
    open_all(env, u["id"], 3)
    p = env.svc.collection.pity(u["id"], "camino")
    assert p.opened == 3 and p.since_rare + p.since_ultra >= 0
    row = env.db.query_one("SELECT * FROM pity WHERE user_id=?", (u["id"],))
    assert row["opened"] == 3


def test_open_pack_collects_cards_and_is_single_use(env):
    u = env.user("op1")
    g = env.svc.rewards.unopened(u["id"])[0]
    res = env.svc.rewards.open_pack(u["id"], g["id"])
    assert len(res["cards"]) == 5
    assert all(c["is_new"] and c["count"] == 1 and c["essence_gained"] == 0
               for c in res["cards"])
    assert set(res["pity"]) >= {"since_rare", "since_ultra", "rare_every", "ultra_every"}
    coll = env.svc.collection.view(u["id"], "camino")
    assert len(coll["owned"]) == 5
    with pytest.raises(Conflict) as again:
        env.svc.rewards.open_pack(u["id"], g["id"])
    assert again.value.code == "pack_already_opened"


def test_duplicates_give_essence_and_increment_count(env):
    u = env.user("dup1")
    results = open_all(env, u["id"], 25)
    total_expected = 0
    for r in results:
        for c in r["cards"]:
            if not c["is_new"]:
                assert c["essence_gained"] == DUP_ESSENCE[c["card"]["rarity"]]
                total_expected += c["essence_gained"]
    assert total_expected > 0
    assert env.svc.wallet.essence(u["id"]) == total_expected
    coll = env.svc.collection.view(u["id"], "camino")
    assert sum(v["count"] for v in coll["owned"].values()) == 25 * 5
    assert results[-1]["essence"] == total_expected


def test_cannot_open_somebody_elses_pack(env):
    a, b = env.user("owner"), env.user("thief")
    g = env.svc.rewards.unopened(a["id"])[0]
    with pytest.raises(NotFound):
        env.svc.rewards.open_pack(b["id"], g["id"])
    assert env.svc.rewards.unopened_count(a["id"]) == 2
    assert env.svc.collection.view(b["id"], "camino")["owned"] == {}


def test_theme_without_catalog_cannot_be_drawn_but_nothing_breaks(env):
    u = env.user("noc", journey="plainpeak")
    g = env.svc.rewards.unopened(u["id"])[0]
    assert g["theme"] == "plainpeak"
    with pytest.raises(NotFound) as e:
        env.svc.rewards.open_pack(u["id"], g["id"])
    assert e.value.code == "catalog_unavailable"
    assert env.svc.rewards.unopened_count(u["id"]) == 2  # still there
    assert env.svc.store.card_count("plainpeak") == 0
    assert env.svc.collection.view(u["id"], "plainpeak")["completion"] == {}


def test_pack_theme_is_fixed_at_grant(env):
    u = env.user("fix1")
    g = env.svc.rewards.grant(u["id"], "camino", "test", "x", "t")
    env.svc.update_profile(u["id"], journey_id="plainpeak")
    res = env.svc.rewards.open_pack(u["id"], g["id"])
    assert res["theme"] == "camino" and all(c["card"]["theme"] == "camino" for c in res["cards"])


def card_of(rarity):
    return next(c for c in build_catalog()["cards"] if c["rarity"] == rarity)


def test_craft_costs_and_rules(env):
    u = env.user("craft1")
    rare = card_of("rare")
    with pytest.raises(WalkhomeError) as e:
        env.svc.rewards.craft(u["id"], rare["id"])
    assert e.value.code == "not_enough_essence"
    env.svc.wallet.add(u["id"], 1000)
    res = env.svc.rewards.craft(u["id"], rare["id"])
    assert res["card_id"] == rare["id"] and res["essence"] == 1000 - CRAFT_COST["rare"]
    assert CRAFT_COST["rare"] == DUP_ESSENCE["rare"] * 4
    with pytest.raises(Conflict) as owned:
        env.svc.rewards.craft(u["id"], rare["id"])
    assert owned.value.code == "already_owned"
    with pytest.raises(WalkhomeError) as secret:
        env.svc.rewards.craft(u["id"], card_of("secret")["id"])
    assert secret.value.code == "not_craftable"
    with pytest.raises(NotFound):
        env.svc.rewards.craft(u["id"], "camino:s1:nope")


def test_album_rewards_at_25_50_75_100_idempotent(env):
    u = env.user("alb1")
    cat = build_catalog()
    s1 = [c for c in cat["cards"] if c["set"] == "s1"]
    own = lambda cards: [env.db.execute(  # noqa: E731
        "INSERT OR IGNORE INTO collection(user_id, card_id, theme, count, first_utc) "
        "VALUES(?,?,?,?,?)", (u["id"], c["id"], "camino", 1, "2026-01-01T00:00:00+00:00"))
        for c in cards]
    own(s1[: max(1, len(s1) // 4 + 1)])
    got = env.svc.rewards.check_album(u["id"], "camino")
    assert [g["source_key"] for g in got] == ["camino:s1:25"]
    assert env.svc.rewards.check_album(u["id"], "camino") == []
    own(s1)
    keys = {g["source_key"] for g in env.svc.rewards.check_album(u["id"], "camino")}
    assert keys == {"camino:s1:50", "camino:s1:75", "camino:s1:100"}
    assert env.svc.rewards.check_album(u["id"], "camino") == []


def test_collection_view_completion(env):
    u = env.user("view1")
    open_all(env, u["id"], 3)
    view = env.svc.collection.view(u["id"], "camino")
    assert set(view["completion"]) == {"s1", "s2"}
    assert sum(v["owned"] for v in view["completion"].values()) == len(view["owned"])
    assert sum(v["total"] for v in view["completion"].values()) == 17
