"""Standings, overtakes, the weekly podium, public profiles."""

import pytest

from app.leaderboard import MIN_PODIUM_M
from app.rewards import MAX_OVERTAKE_PACKS_PER_DAY


def rank_grants(env, uid):
    return env.db.query("SELECT * FROM pack_grants WHERE user_id=? AND source='rank'", (uid,))


def test_periods_and_themes(env):
    a, b = env.user("lba"), env.user("lbb")
    env.session_row(a["id"], 3000)                    # this week
    env.session_row(a["id"], 4000, days_ago=10)       # this month (Oct 4)... previous week
    env.session_row(b["id"], 9000, days_ago=45)       # only 'all'
    env.session_row(b["id"], 1000, journey="plainpeak")
    lb = env.svc.board
    start, end = lb.window("week")
    assert dict(lb.standings("camino", start, end)) == {a["id"]: 3000}
    mstart, mend = lb.window("month")
    assert dict(lb.standings("camino", mstart, mend)) == {a["id"]: 7000}
    assert lb.standings("camino") == [(b["id"], 9000), (a["id"], 7000)]
    assert dict(lb.standings("plainpeak")) == {b["id"]: 1000}


def test_board_rows_and_viewer(env):
    a, b, c = env.user("bra"), env.user("brb"), env.user("brc")
    env.session_row(a["id"], 3000)
    env.session_row(b["id"], 5000)
    out = env.svc.board.board(a["id"], "camino", "week")
    assert out["total"] == 2 and out["me_rank"] == 2 and out["period"] == "week"
    first, second = out["rows"]
    assert first["rank"] == 1 and first["profile"]["id"] == b["id"] and not first["is_me"]
    assert first["gap_to_next_m"] is None and second["gap_to_next_m"] == 2000
    assert second["is_me"] and second["distance_m"] == 3000
    assert set(first["profile"]) == {
        "id", "username", "display_name", "avatar", "color", "journey_id", "progress_m",
        "fraction", "stage_name", "biome_name", "streak_days", "cards_owned", "cards_total",
        "walking_now", "best_rarity"}
    # a viewer who did not walk has no rank
    assert env.svc.board.board(c["id"], "camino", "week")["me_rank"] is None
    with pytest.raises(Exception):
        env.svc.board.board(a["id"], "camino", "decade")


def test_delta_rank_vs_start_of_today(env):
    a, b = env.user("dra"), env.user("drb")
    env.session_row(a["id"], 5000, days_ago=1)
    env.session_row(b["id"], 3000, days_ago=1)
    env.session_row(b["id"], 4000)  # today: b overtakes a
    out = env.svc.board.board(a["id"], "camino", "week")
    deltas = {r["profile"]["id"]: r["delta_rank"] for r in out["rows"]}
    assert deltas == {b["id"]: 1, a["id"]: -1}


def test_archived_players_leave_the_board(env):
    a = env.user("arc1")
    env.session_row(a["id"], 3000)
    env.svc.admin_update_user(a["id"], archived=1)
    assert env.svc.board.standings("camino") == []


def test_overtake_notifies_both_pays_the_overtaker_and_stays_private(env):
    a, b = env.user("ova"), env.user("ovb")
    env.session_row(a["id"], 6000)
    env.session_row(b["id"], 4000)
    env.svc.board.snapshot_baseline("camino")
    env.svc.outbox.clear()
    env.svc.add_manual_session(b["id"], 3000, 40)  # b: 7000 > a: 6000
    kinds = lambda uid: [d for u, t, d in env.svc.outbox if u == uid and t == "rank"]  # noqa: E731
    assert len(kinds(b["id"])) == 1 and len(kinds(a["id"])) == 1
    assert kinds(b["id"])[0]["overtook"]["id"] == a["id"] and kinds(b["id"])[0]["rank"] == 1
    assert kinds(a["id"])[0]["overtaken_by"]["id"] == b["id"]
    assert kinds(a["id"])[0]["previous_rank"] == 1 and kinds(a["id"])[0]["rank"] == 2
    na = [n for n in env.svc.notifier.list(a["id"]) if n["kind"] == "rank_overtake"]
    nb = [n for n in env.svc.notifier.list(b["id"]) if n["kind"] == "rank_overtake"]
    assert len(na) == 1 and len(nb) == 1
    assert len(rank_grants(env, b["id"])) == 1 and len(rank_grants(env, a["id"])) == 0
    # evaluating again without change pays and notifies nothing new
    env.svc.board.check_overtakes(b["id"], "camino")
    assert len(rank_grants(env, b["id"])) == 1
    assert len([n for n in env.svc.notifier.list(a["id"]) if n["kind"] == "rank_overtake"]) == 1


def test_overtake_packs_capped_per_day(env):
    hero = env.user("hero")
    victims = [env.user(f"vic{i}") for i in range(MAX_OVERTAKE_PACKS_PER_DAY + 2)]
    for v in victims:
        env.session_row(v["id"], 2000)
    env.svc.board.snapshot_baseline("camino")
    env.svc.add_manual_session(hero["id"], 3000, 40)
    assert len(rank_grants(env, hero["id"])) == MAX_OVERTAKE_PACKS_PER_DAY
    notes = [n for n in env.svc.notifier.list(hero["id"]) if n["kind"] == "rank_overtake"]
    assert len(notes) == len(victims)


def test_tiny_walkers_do_not_count_as_overtaken(env):
    a, b = env.user("tia"), env.user("tib")
    env.session_row(a["id"], 200)
    env.svc.board.snapshot_baseline("camino")
    env.svc.add_manual_session(b["id"], 500, 8)
    assert env.svc.notifier.list(a["id"], 10)[0]["kind"] != "rank_overtake"
    assert rank_grants(env, b["id"]) == []


def test_weekly_podium_paid_once_lazily(env):
    users = [env.user(n) for n in ("pod1", "pod2", "pod3", "pod4")]
    dist = [9000, 7000, 5000, 3000]
    for u, d in zip(users, dist):
        env.session_row(u["id"], d)
    tiny = env.user("tiny")
    env.session_row(tiny["id"], MIN_PODIUM_M - 1)
    env.clock.advance(days=5)  # Monday 2026-10-19
    paid = env.svc.board.settle_weekly_podium()
    assert len(paid) == 3 + 2 + 1
    by_user = {}
    for g in paid:
        by_user.setdefault(g["source_key"].split(":")[2].split("#")[0], 0)
        by_user[g["source_key"].split(":")[2].split("#")[0]] += 1
    assert by_user == {"1": 3, "2": 2, "3": 1}
    assert len(rank_grants(env, users[0]["id"])) == 3
    assert len(rank_grants(env, users[3]["id"])) == 0
    assert len(rank_grants(env, tiny["id"])) == 0
    n = [x for x in env.svc.notifier.list(users[0]["id"]) if x["kind"] == "weekly_podium"]
    assert len(n) == 1 and n[0]["data"]["place"] == 1
    awards = env.db.query("SELECT * FROM weekly_awards ORDER BY place")
    assert [(r["week_key"], r["place"], r["user_id"]) for r in awards] == [
        ("2026-W42", 1, users[0]["id"]), ("2026-W42", 2, users[1]["id"]),
        ("2026-W42", 3, users[2]["id"])]
    # idempotent: same call, and a fresh Leaderboard instance (restart), pay nothing
    assert env.svc.board.settle_weekly_podium() == []
    env.svc.board._podium_checked_for = None
    assert env.svc.board.settle_weekly_podium() == []
    assert len(rank_grants(env, users[0]["id"])) == 3


def test_podium_triggered_by_first_board_call_after_rollover(env):
    a = env.user("lazy1")
    env.session_row(a["id"], 4000)
    env.clock.advance(days=6)
    env.svc.board.board(a["id"], "camino", "week")
    assert len(rank_grants(env, a["id"])) == 3


def test_public_profile_hides_private_data(env):
    a = env.user("pp1")
    env.session_row(a["id"], 3000)
    env.svc.admin_update_user(a["id"], handicap=2.0)
    p = env.svc.profiles.by_id(a["id"])
    blob = str(p)
    for secret in ("password", "handicap", "daily_goal", "note", "hr", "journal", "token"):
        assert secret not in blob
    assert p["progress_m"] == pytest.approx(6000.0)  # handicap applied to progress only
    assert p["cards_total"] == 17 and p["walking_now"] is False
