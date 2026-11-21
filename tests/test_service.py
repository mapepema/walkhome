"""Service-level behaviour: sessions, derived progress, the event engine,
the unique treadmill, recovery after a 'reboot' (attached to the right player)."""

import random

import pytest

from app.ble import NullTelemetrySource
from app.content import ContentLibrary
from app.errors import Conflict, Forbidden, WalkhomeError
from app.hub import Hub
from app.service import WalkhomeService
from tests.conftest import MI_TO_M


def test_session_lifecycle_and_derived_progress(env):
    a = env.user("robin")
    env.svc.start_session(a["id"])
    env.feed(seconds=60)
    env.svc._checkpoint(force=True)
    snap = env.svc.session_snapshot()
    assert snap["telemetry"]["distance_m"] == pytest.approx(100.0, rel=0.02)

    summary = env.svc.stop_session(a["id"])
    assert summary["distance_m"] == pytest.approx(100.0, rel=0.02)
    assert summary["end_utc"] is not None
    assert env.svc.user_progress_m(a["id"], "camino") == pytest.approx(100.0, rel=0.02)


def test_handicap_scales_progress(env):
    kid = env.user("pippin")
    env.svc.admin_update_user(kid["id"], handicap=2.0)
    env.svc.start_session(kid["id"])
    env.feed(seconds=60)
    env.svc.stop_session(kid["id"])
    assert env.svc.user_progress_m(kid["id"], "camino") == pytest.approx(200.0, rel=0.02)


def test_events_fire_once_and_survive_restart(env, content_dir):
    sam = env.user("sam")
    env.svc.add_adjustment(sam["id"], 13_000, reason="test")
    ids = {r["event_id"] for r in env.db.query(
        "SELECT event_id FROM fired_events WHERE subject_id=?", (sam["id"],))}
    assert len(ids) == 3  # km 0, 0.5 (choice) and 8, before the first climb at km 14

    env.svc.start_session(sam["id"])
    env.feed(seconds=120)
    env.svc.stop_session(sam["id"])
    assert all(r["n"] == 1 for r in env.db.query(
        "SELECT COUNT(*) AS n FROM fired_events WHERE subject_id=? GROUP BY event_id",
        (sam["id"],)))

    # a restarted service over the same DB does not re-fire anything
    svc2 = WalkhomeService(env.cfg, env.db, ContentLibrary(content_dir), Hub(),
                           source=NullTelemetrySource(), clock=env.clock)
    before = env.db.query_one("SELECT COUNT(*) AS n FROM fired_events")["n"]
    svc2._sync_after_change(sam["id"], "camino", 0.0)
    svc2._fire_events(svc2.library.require("camino"), sam["id"], 0.0, 13_000.0, None)
    assert env.db.query_one("SELECT COUNT(*) AS n FROM fired_events")["n"] == before


def test_challenge_fires_on_the_pyrenees_climb(env):
    merry = env.user("merry")
    env.svc.add_adjustment(merry["id"], 13_990, reason="test")  # the climb starts at km 14
    env.svc.start_session(merry["id"])
    env.feed(seconds=30)
    assert env.svc.session.challenge is not None
    env.svc.stop_session(merry["id"])
    row = env.db.query_one("SELECT * FROM challenge_results WHERE user_id=?", (merry["id"],))
    assert row is not None and row["succeeded"] == 0  # force-failed on stop
    kinds = [(u, t) for u, t, _ in env.svc.outbox if t == "challenge"]
    assert kinds and all(u == merry["id"] for u, _ in kinds)  # private to the walker


def test_session_reassignment_is_gone_progress_is_per_user(env):
    a, b = env.user("gus"), env.user("lena")
    env.svc.start_session(a["id"])
    env.feed(seconds=60)
    env.svc.stop_session(a["id"])
    assert env.svc.user_progress_m(a["id"], "camino") > 50
    assert env.svc.user_progress_m(b["id"], "camino") == 0.0


def test_manual_session_and_adjustment(env):
    u = env.user("bjorn")
    env.svc.add_manual_session(u["id"], distance_m=2500, minutes=30, note="outdoors")
    assert env.svc.user_progress_m(u["id"], "camino") == pytest.approx(2500.0)
    env.svc.add_adjustment(u["id"], -500, reason="overcounted")
    assert env.svc.user_progress_m(u["id"], "camino") == pytest.approx(2000.0)


def test_manual_session_rejects_future_and_garbage(env):
    u = env.user("bea")
    with pytest.raises(WalkhomeError):
        env.svc.add_manual_session(u["id"], 1000, 10, when_utc="2099-01-01T00:00:00+00:00")
    with pytest.raises(WalkhomeError):
        env.svc.add_manual_session(u["id"], 1000, 10, when_utc="not a date")
    with pytest.raises(WalkhomeError):
        env.svc.add_manual_session(u["id"], 0, 10)


def test_progress_never_negative(env):
    u = env.user("bea2")
    env.svc.add_adjustment(u["id"], -5000, reason="mistake")
    assert env.svc.user_progress_m(u["id"], "camino") == 0.0


def test_treadmill_is_unique(env):
    a, b = env.user("anna"), env.user("ben")
    assert env.svc.treadmill() == {"busy": False, "walker": None}
    env.svc.start_session(a["id"])
    tm = env.svc.treadmill()
    assert tm["busy"] and tm["walker"]["id"] == a["id"]
    with pytest.raises(Conflict) as busy:
        env.svc.start_session(b["id"])
    assert busy.value.code == "treadmill_busy" and busy.value.status == 409
    with pytest.raises(Conflict) as again:
        env.svc.start_session(a["id"])
    assert again.value.code == "already_walking"
    # b cannot drive a's walk
    for op in (env.svc.pause_session, env.svc.resume_session, env.svc.stop_session):
        with pytest.raises(Forbidden):
            op(b["id"])
    # ...and b sees the belt as busy but no session of a's
    snap_b = env.svc.snapshot_for(b["id"])
    assert snap_b["treadmill"]["busy"] and snap_b["session"] is None
    assert "telemetry" not in str(snap_b["treadmill"])
    env.svc.stop_session(a["id"])
    env.svc.start_session(b["id"])


def test_recover_open_session_after_crash_attaches_right_user(env, content_dir):
    a, b = env.user("theoden"), env.user("eomer")
    env.svc.start_session(b["id"])
    env.feed(seconds=60)
    env.svc._checkpoint(force=True)
    session_id = env.svc.session.id
    # crash: no stop, a new service over the same DB
    svc2 = WalkhomeService(env.cfg, env.db, ContentLibrary(content_dir), Hub(),
                           source=NullTelemetrySource(), clock=env.clock,
                           rng=random.Random(1))
    svc2._recover_open_session()
    assert svc2.session is not None and svc2.session.id == session_id
    assert svc2.session.user_id == b["id"]
    assert svc2.treadmill()["walker"]["id"] == b["id"]
    with pytest.raises(Conflict):
        svc2.start_session(a["id"])
    for i in range(61):
        from app.ftms import TreadmillSample
        svc2._handle_sample(TreadmillSample(speed_kmh=6.0), at=1000.0 + i)
    svc2._checkpoint(force=True)
    summary = svc2.stop_session(b["id"])
    assert summary["distance_m"] == pytest.approx(200.0, rel=0.03)
    assert summary["user_id"] == b["id"]


def test_no_distance_during_manual_pause(env):
    u = env.user("faramir")
    env.svc.start_session(u["id"])
    env.feed(seconds=10)
    d1 = env.svc.session.tracker.distance_m
    env.svc.pause_session(u["id"])
    env.feed(seconds=30, start=11.0)
    assert env.svc.session.tracker.distance_m == d1
    env.svc.resume_session(u["id"])
    env.feed(seconds=10, start=45.0)
    assert env.svc.session.tracker.distance_m == pytest.approx(d1 + 10 * 6.0 / 3.6, rel=0.05)
    env.svc.stop_session(u["id"])


def test_delete_user_removes_everything(env):
    a, b = env.user("grima"), env.user("eomer2")
    env.svc.add_manual_session(a["id"], 4000, 40)
    env.svc.add_manual_session(b["id"], 1000, 10)
    env.svc.delete_user(a["id"])
    assert env.svc.get_user(a["id"]) is None
    assert env.svc.journal(a["id"]) == []
    for table in ("sessions", "pack_grants", "wallet", "auth_tokens", "notifications"):
        assert env.db.query_one(
            f"SELECT COUNT(*) AS n FROM {table} WHERE user_id=?", (a["id"],))["n"] == 0
    assert env.svc.user_progress_m(b["id"], "camino") == pytest.approx(1000.0)


def test_delete_user_refused_mid_walk(env):
    u = env.user("denethor")
    env.svc.start_session(u["id"])
    with pytest.raises(Conflict):
        env.svc.delete_user(u["id"])
    env.svc.stop_session(u["id"])
    env.svc.delete_user(u["id"])


def test_subject_view_and_eta(env):
    u = env.user("marta")
    env.svc.add_manual_session(u["id"], 10_000, 100)
    view = env.svc.subject_view(u["id"], "camino")
    assert view["kind"] == "user"
    assert view["progress_m"] == pytest.approx(10_000.0)
    assert view["biome"] and view["next_milestone"] and view["pace_m_per_day"] > 0


def test_snapshot_shape(env):
    u = env.user("shape")
    snap = env.svc.snapshot_for(u["id"])
    assert set(snap) >= {"me", "journey_id", "units", "link", "treadmill", "session",
                         "subject", "packs", "rank", "unread_notifications"}
    assert set(snap["me"]) >= {"id", "username", "display_name", "avatar", "color",
                               "journey_id", "is_admin", "handicap", "daily_goal_m", "units",
                               "created_utc", "wallet", "unopened_packs", "push"}
    assert "password_hash" not in str(snap)
    assert snap["me"]["unopened_packs"] == 2  # welcome packs
    assert set(snap["rank"]) == {"week", "all", "total"}
