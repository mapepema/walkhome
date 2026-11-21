"""Daily / weekly / story quests: derived progress, one claim per period."""

import pytest

from app.errors import Conflict, NotFound, WalkhomeError


def q(env, uid, qid):
    return next(x for x in env.svc.quests.list(uid) if x["id"] == qid)


def test_catalog_shape(env):
    u = env.user("qs1")
    quests = env.svc.quests.list(u["id"])
    ids = {x["id"] for x in quests}
    assert {"d_walk_2km", "d_pace", "d_challenge", "w_5km_x3", "w_15km", "w_open_5",
            "w_milestone"} <= ids
    assert any(x["period"] == "story" for x in quests)
    for x in quests:
        assert set(x) == {"id", "period", "icon", "title", "description", "target", "progress",
                          "unit", "reward", "claimable", "claimed", "expires_utc"}
        assert x["progress"] == 0 and not x["claimable"] and not x["claimed"]
        assert x["period"] == "story" or x["expires_utc"]


def test_daily_distance_quest_claim_once_then_resets_tomorrow(env):
    u = env.user("qs2")
    env.session_row(u["id"], 2500)
    assert q(env, u["id"], "d_walk_2km")["claimable"]
    out = env.svc.quests.claim(u["id"], "d_walk_2km")
    assert len(out["granted"]) == 1 and out["granted"][0]["source"] == "quest"
    assert out["granted"][0]["source_key"] == "d_walk_2km:2026-10-14"
    assert q(env, u["id"], "d_walk_2km")["claimed"]
    with pytest.raises(Conflict) as e:
        env.svc.quests.claim(u["id"], "d_walk_2km")
    assert e.value.code == "quest_already_claimed"
    env.clock.advance(days=1)
    fresh = q(env, u["id"], "d_walk_2km")
    assert not fresh["claimed"] and fresh["progress"] == 0


def test_claim_requires_completion_and_known_quest(env):
    u = env.user("qs3")
    with pytest.raises(WalkhomeError) as e:
        env.svc.quests.claim(u["id"], "d_walk_2km")
    assert e.value.code == "quest_not_complete"
    with pytest.raises(NotFound):
        env.svc.quests.claim(u["id"], "nope")


def test_essence_reward_returns_balance(env):
    u = env.user("qs4")
    env.db.execute(
        "INSERT INTO challenge_results(session_id, user_id, event_id, title, succeeded, "
        "created_utc) VALUES(NULL, ?, 'e1', 't', 1, ?)", (u["id"], env.clock().isoformat()))
    assert q(env, u["id"], "d_challenge")["claimable"]
    out = env.svc.quests.claim(u["id"], "d_challenge")
    assert out["granted"] == [] and out["essence"] == 40 == env.svc.wallet.essence(u["id"])


def test_pace_quest_needs_a_sustained_fast_walk(env):
    u = env.user("qs5")
    # 10 min at 3 km/h: no
    env.db.execute(
        "INSERT INTO sessions(user_id, journey_id, source, state, start_utc, distance_m, "
        "moving_s, updated_utc) VALUES(?, 'camino', 'treadmill', 'ended', ?, 500, 600, ?)",
        (u["id"], env.clock().isoformat(), env.clock().isoformat()))
    assert q(env, u["id"], "d_pace")["progress"] == 0
    env.db.execute(
        "INSERT INTO sessions(user_id, journey_id, source, state, start_utc, distance_m, "
        "moving_s, updated_utc) VALUES(?, 'camino', 'treadmill', 'ended', ?, 1000, 700, ?)",
        (u["id"], env.clock().isoformat(), env.clock().isoformat()))
    assert q(env, u["id"], "d_pace")["claimable"]


def test_weekly_quests(env):
    u = env.user("qs6")
    for d in (0, 1, 2):  # Wed, Tue, Mon of this week
        env.session_row(u["id"], 5200, days_ago=d)
    assert q(env, u["id"], "w_5km_x3")["claimable"]
    assert q(env, u["id"], "w_15km")["claimable"]  # 15.6 km
    env.session_row(u["id"], 5200, days_ago=9)  # last week: not counted
    assert q(env, u["id"], "w_15km")["progress"] == 15000  # capped at target
    out = env.svc.quests.claim(u["id"], "w_15km")
    assert len(out["granted"]) == 1 and out["essence_gained"] == 30
    assert out["granted"][0]["source_key"] == "w_15km:2026-W42"


def test_open_five_packs_quest(env):
    u = env.user("qs7")
    for i in range(3):
        env.svc.rewards.grant(u["id"], "camino", "test", f"g{i}", "t")
    for g in env.svc.rewards.unopened(u["id"]):
        env.svc.rewards.open_pack(u["id"], g["id"])
    assert q(env, u["id"], "w_open_5")["claimable"]


def test_story_quest_follows_the_journey_milestones(env):
    u = env.user("qs8")
    story = q(env, u["id"], next(x["id"] for x in env.svc.quests.list(u["id"])
                                 if x["period"] == "story"))
    assert story["id"].startswith("story:camino:") and not story["claimable"]
    env.svc.add_adjustment(u["id"], story["target"] + 5, "test")
    story = q(env, u["id"], story["id"])
    assert story["claimable"] and story["progress"] == pytest.approx(story["target"], abs=0.1)
    out = env.svc.quests.claim(u["id"], story["id"])
    assert len(out["granted"]) == 1
    nxt = next(x for x in env.svc.quests.list(u["id"]) if x["period"] == "story")
    assert nxt["id"] != story["id"]


def test_quests_are_per_user(env):
    a, b = env.user("qa1"), env.user("qb1")
    env.session_row(a["id"], 2500)
    env.svc.quests.claim(a["id"], "d_walk_2km")
    assert not q(env, b["id"], "d_walk_2km")["claimed"]
    with pytest.raises(WalkhomeError):
        env.svc.quests.claim(b["id"], "d_walk_2km")
