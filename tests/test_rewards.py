"""The reward engine: derived, idempotent, capped against manual cheating."""

import pytest

from app.rewards import PODIUM_PACKS
from app.stats import rewardable_manual_m


def grants(env, uid, source=None):
    sql = "SELECT * FROM pack_grants WHERE user_id=?"
    params = [uid]
    if source:
        sql += " AND source=?"
        params.append(source)
    return env.db.query(sql + " ORDER BY id", params)


def test_welcome_packs_once(env):
    u = env.user("w1")
    assert [g["source_key"] for g in grants(env, u["id"], "welcome")] == ["1", "2"]
    assert env.svc.rewards.grant_welcome(u["id"]) == []  # idempotent
    assert env.svc.rewards.unopened_count(u["id"]) == 2


def test_distance_packs_every_pack_every_m_and_idempotent(env):
    u = env.user("d1")
    env.session_row(u["id"], 5000)
    new = env.svc.rewards.evaluate(u["id"])
    dist = [g for g in new if g["source"] == "distance"]
    assert [g["source_key"] for g in dist] == ["camino:1", "camino:2"]
    assert all(g["theme"] == "camino" for g in dist)
    # running it again, or on a 'restarted' engine, pays nothing
    assert env.svc.rewards.evaluate(u["id"]) == []
    env.session_row(u["id"], 1500)  # 6500 total -> third threshold
    again = [g for g in env.svc.rewards.evaluate(u["id"]) if g["source"] == "distance"]
    assert [g["source_key"] for g in again] == ["camino:3"]
    assert len(grants(env, u["id"], "distance")) == 3


def test_pack_every_m_comes_from_the_content_pack(env):
    u = env.user("d2")
    env.svc.library.get("camino").data["rewards"]["pack_every_m"] = 1000
    env.session_row(u["id"], 3500)
    assert len(grants_after(env, u["id"], "distance")) == 3
    view = env.svc.rewards.packs_view(u["id"])
    assert view["pack_every_m"] == 1000 and view["next_pack_in_m"] == pytest.approx(500)


def grants_after(env, uid, source):
    env.svc.rewards.evaluate(uid)
    return grants(env, uid, source)


def test_distance_is_per_theme_and_pack_carries_theme(env):
    u = env.user("d3")
    env.session_row(u["id"], 2100, journey="plainpeak")
    env.svc.rewards.evaluate(u["id"])
    g = grants(env, u["id"], "distance")
    assert len(g) == 1 and g[0]["theme"] == "plainpeak" and g[0]["source_key"] == "plainpeak:1"


def test_daily_pack_first_km_of_today_only(env):
    u = env.user("day1")
    env.session_row(u["id"], 600)
    assert grants_after(env, u["id"], "daily") == []
    env.session_row(u["id"], 600)  # 1200 m today
    got = grants_after(env, u["id"], "daily")
    assert len(got) == 1 and got[0]["source_key"] == "2026-10-14"
    env.svc.rewards.evaluate(u["id"])
    assert len(grants(env, u["id"], "daily")) == 1


def test_backdated_walk_does_not_earn_a_daily_pack(env):
    u = env.user("day2")
    env.session_row(u["id"], 3000, days_ago=5)
    assert grants_after(env, u["id"], "daily") == []


def test_streak_tiers(env):
    u = env.user("s1")
    for d in range(3):
        env.session_row(u["id"], 300, days_ago=d)
    got = grants_after(env, u["id"], "streak")
    assert [g["source_key"] for g in got] == ["3"]
    for d in range(3, 7):
        env.session_row(u["id"], 300, days_ago=d)
    assert [g["source_key"] for g in grants_after(env, u["id"], "streak")] == ["3", "7"]


def test_streak_tolerates_one_grace_day(env):
    u = env.user("s2")
    for d in (0, 1, 3, 4):  # day 2 missed
        env.session_row(u["id"], 300, days_ago=d)
    st = env.svc.stats.streak(u["id"])
    assert st["days"] == 4 and st["grace_used"] == 1  # days walked, gap forgiven
    env.session_row(u["id"], 300, days_ago=6)  # a second gap -> chain stops there
    assert env.svc.stats.streak(u["id"])["days"] == 4


def test_milestone_pack_idempotent(env):
    u = env.user("m1")
    first = next(e for e in env.svc.library.require("camino").events
                 if e["kind"] == "milestone" and e["at_m"] > 0)
    env.svc.add_adjustment(u["id"], first["at_m"] + 10, "head start")
    ms = grants(env, u["id"], "milestone")
    assert len(ms) >= 1 and ms[0]["source_key"].startswith("camino:")
    n = len(ms)
    env.svc.rewards.evaluate(u["id"])
    env.svc._sync_after_change(u["id"], "camino", 0.0)
    assert len(grants(env, u["id"], "milestone")) == n


def test_manual_rewards_are_capped_per_day(env):
    u = env.user("cap1")
    # two plausible 4 km walks at 5 km/h the same day: only 5 km earns packs
    env.svc.add_manual_session(u["id"], 4000, 48)
    env.svc.add_manual_session(u["id"], 4000, 48)
    assert env.svc.stats.reward_m_by_theme(u["id"])["camino"] == pytest.approx(5000)
    # but they count fully for progress and the leaderboard
    assert env.svc.user_progress_m(u["id"], "camino") == pytest.approx(8000)
    assert env.svc.board.standings("camino")[0][1] == pytest.approx(8000)
    assert len(grants(env, u["id"], "distance")) == 2  # 5000 // 2000


def test_implausible_manual_speed_capped_at_400m():
    assert rewardable_manual_m(3000, 600, 5000) == 400       # 18 km/h
    assert rewardable_manual_m(3000, 0, 5000) == 400         # no duration
    assert rewardable_manual_m(3000, 3600, 5000) == 3000     # 3 km/h fine
    assert rewardable_manual_m(3000, 3600, 1200) == 1200     # day cap left


def test_manual_cheat_cannot_farm_packs(env):
    u = env.user("cheat")
    for _ in range(10):
        env.svc.add_manual_session(u["id"], 200_000, 1)  # absurd speed
    # each entry is worth 400 m of rewards at most
    assert env.svc.stats.reward_m_by_theme(u["id"])["camino"] == pytest.approx(4000.0)
    assert len(grants(env, u["id"], "distance")) == 2


def test_delete_then_readd_does_not_repay(env):
    u = env.user("redo")
    env.session_row(u["id"], 4100)
    env.svc.rewards.evaluate(u["id"])
    n = len(grants(env, u["id"], "distance"))
    sid = env.db.query_one("SELECT id FROM sessions WHERE user_id=?", (u["id"],))["id"]
    env.svc.delete_session(u["id"], sid)
    env.session_row(u["id"], 4100)
    env.svc.rewards.evaluate(u["id"])
    assert len(grants(env, u["id"], "distance")) == n


def test_reward_is_pushed_only_to_its_owner(env):
    a, b = env.user("ra"), env.user("rb")
    env.svc.outbox.clear()
    env.session_row(a["id"], 2500)
    env.svc.rewards.evaluate(a["id"])
    rewards = [(uid, d) for uid, t, d in env.svc.outbox if t == "reward"]
    assert rewards and all(uid == a["id"] for uid, _ in rewards)
    assert env.svc.notifier.unread_count(b["id"]) == 1  # b only has the welcome note


def test_live_walk_pays_packs_during_the_walk(env):
    u = env.user("live")
    env.svc.start_session(u["id"])
    env.feed(speed_kmh=7.2, seconds=1100)  # ~2.2 km
    env.svc._checkpoint(force=True)
    env.svc.session.last_eval = -1e9
    env.svc._tick(1100.5, 1.0)
    assert len(grants(env, u["id"], "distance")) == 1
    env.svc.stop_session(u["id"])
    assert len(grants(env, u["id"], "distance")) == 1


def test_podium_constants():
    assert PODIUM_PACKS == {1: 3, 2: 2, 3: 1}
