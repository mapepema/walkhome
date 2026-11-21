"""v1 -> v2 migration on a database created with the *old* schema."""

import sqlite3

import pytest

from app.auth import AuthService
from app.config import Config
from app.db import SCHEMA_V1, SCHEMA_VERSION, Database, slugify
from tests.conftest import FakeClock, START, PASSWORD


def make_v1(path):
    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA_V1)
    conn.execute("INSERT INTO meta(key,value) VALUES('schema_version','1')")
    now = "2026-09-01T10:00:00+00:00"
    users = [("Robin", "🧝"), ("Björn the Bold", "🛡️"), ("robin!", "🧙"), ("ñ", "🐢")]
    for name, av in users:
        conn.execute(
            "INSERT INTO users(display_name, avatar, handicap, journey_id, created_utc) "
            "VALUES(?,?,?,?,?)", (name, av, 1.5, "camino", now))
    conn.execute("INSERT INTO parties(name, journey_id, created_utc) VALUES('Household','camino',?)", (now,))
    conn.execute("INSERT INTO party_members VALUES(1,1)")
    conn.execute(
        "INSERT INTO sessions(user_id, journey_id, state, start_utc, end_utc, distance_m, "
        "elapsed_s, updated_utc) VALUES(1,'camino','ended',?,?,4200,3000,?)", (now, now, now))
    conn.execute("INSERT INTO adjustments(user_id, journey_id, delta_m, reason, created_utc) "
                 "VALUES(1,'camino',500,'x',?)", (now,))
    conn.execute("INSERT INTO fired_events(journey_id, subject_kind, subject_id, event_id, at_m, fired_utc) "
                 "VALUES('camino','user',1,'e0000',0,?)", (now,))
    conn.execute("INSERT INTO fired_events(journey_id, subject_kind, subject_id, event_id, at_m, fired_utc) "
                 "VALUES('camino','party',1,'e0000',0,?)", (now,))
    conn.execute("INSERT INTO journal(journey_id, subject_kind, subject_id, title, created_utc) "
                 "VALUES('camino','party',1,'p',?)", (now,))
    conn.execute("INSERT INTO journal(journey_id, subject_kind, subject_id, title, created_utc) "
                 "VALUES('camino','user',1,'u',?)", (now,))
    conn.execute("INSERT INTO challenge_results(session_id,user_id,event_id,title,succeeded,created_utc) "
                 "VALUES(1,1,'c1','t',1,?)", (now,))
    conn.commit()
    conn.close()


def test_schema_version_is_2():
    assert SCHEMA_VERSION == 2


def test_migrates_without_losing_data(tmp_path):
    path = tmp_path / "v1.db"
    make_v1(path)
    db = Database(path)
    assert db.get_setting("x") is None
    assert db.query_one("SELECT value FROM meta WHERE key='schema_version'")["value"] == "2"

    users = {r["display_name"]: dict(r) for r in db.query("SELECT * FROM users")}
    assert len(users) == 4
    assert users["Robin"]["username"] == "robin"
    assert users["Robin"]["handicap"] == 1.5 and users["Robin"]["avatar"] == "🧝"
    assert users["Robin"]["password_hash"] is None and users["Robin"]["is_admin"] == 0
    assert users["Robin"]["units"] == "km"
    assert users["Björn the Bold"]["username"] == "bjorn-the-bold"
    # collisions get a numeric suffix, names too short get a fallback
    assert users["robin!"]["username"] != users["Robin"]["username"]
    assert users["robin!"]["username"].lower().startswith("robin")
    assert len(users["ñ"]["username"]) >= 3
    assert len({u["username"].lower() for u in users.values()}) == 4

    # derived data intact, party rows gone
    assert db.query_one("SELECT distance_m FROM sessions")["distance_m"] == 4200
    assert db.query_one("SELECT delta_m FROM adjustments")["delta_m"] == 500
    assert db.query_one("SELECT COUNT(*) AS n FROM challenge_results")["n"] == 1
    assert [r["subject_kind"] for r in db.query("SELECT subject_kind FROM fired_events")] == ["user"]
    assert [r["subject_kind"] for r in db.query("SELECT subject_kind FROM journal")] == ["user"]
    tables = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    assert not ({"parties", "party_members"} & tables)
    assert {"auth_tokens", "pack_grants", "collection", "wallet", "pity", "quest_claims",
            "notifications", "push_subscriptions", "rank_snapshots", "weekly_awards"} <= tables
    db.close()


def test_migration_is_idempotent_and_reopenable(tmp_path):
    path = tmp_path / "v1.db"
    make_v1(path)
    Database(path).close()
    db = Database(path)  # second open: nothing to do, nothing breaks
    assert db.query_one("SELECT COUNT(*) AS n FROM users")["n"] == 4
    assert db.query_one("SELECT value FROM meta WHERE key='schema_version'")["value"] == "2"
    db.close()


def test_fresh_database_is_v2(tmp_path):
    db = Database(tmp_path / "fresh.db")
    assert db.query_one("SELECT value FROM meta WHERE key='schema_version'")["value"] == "2"
    cols = {r["name"] for r in db.query("PRAGMA table_info(users)")}
    assert {"username", "password_hash", "is_admin", "units", "last_seen_utc"} <= cols
    db.close()


def test_legacy_account_can_be_claimed(tmp_path):
    path = tmp_path / "v1.db"
    make_v1(path)
    db = Database(path)
    auth = AuthService(db, Config(), FakeClock(START))
    # cannot log in before claiming
    with pytest.raises(Exception) as e:
        auth.login("robin", PASSWORD)
    assert getattr(e.value, "code", "") == "claim_required"
    user = auth.claim("robin", PASSWORD)
    assert user["password_hash"] and user["is_admin"] == 1  # nobody else was admin
    assert auth.login("robin", PASSWORD)["id"] == user["id"]
    # a claimed (or unknown) account cannot be claimed again
    with pytest.raises(Exception) as again:
        auth.claim("robin", "another-password")
    assert getattr(again.value, "code", "") == "not_claimable"
    # the second legacy walker is not admin
    assert auth.claim("bjorn-the-bold", PASSWORD)["is_admin"] == 0
    db.close()


def test_slugify():
    assert slugify("Björn the Bold") == "bjorn-the-bold"
    assert slugify("a") == "walker"
    assert slugify("  Sam  ") == "sam"
    assert slugify("x" * 60) == "x" * 24


def test_claim_over_http_on_a_migrated_database(tmp_path, content_dir):
    from fastapi.testclient import TestClient

    from app.server import create_app
    from tests.conftest import make_config

    cfg = make_config(tmp_path, content_dir, name="legacy.db")
    make_v1(cfg.db_path)
    with TestClient(create_app(cfg)) as c:
        assert c.post("/api/auth/login", json={"username": "robin", "password": PASSWORD}
                      ).json()["code"] == "claim_required"
        r = c.post("/api/auth/claim", json={"username": "robin", "password": PASSWORD})
        assert r.status_code == 200
        me = r.json()
        assert me["username"] == "robin" and me["display_name"] == "Robin"
        assert me["handicap"] == 1.5 and me["is_admin"] is True and me["unopened_packs"] == 2
        # the legacy history is still there, scoped to the claimed account
        sessions = c.get("/api/me/sessions").json()
        assert [s["distance_m"] for s in sessions] == [4200]
        assert c.get("/api/me/state").json()["subject"]["progress_m"] == 4200 * 1.5 + 500
        # claiming twice is refused
        again = c.post("/api/auth/claim", json={"username": "robin", "password": PASSWORD})
        assert again.status_code == 403 and again.json()["code"] == "not_claimable"
