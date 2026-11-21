"""One player must never be able to read or change another player's data."""

import time

import pytest

from tests.conftest import register


@pytest.fixture()
def duo(make_client):
    c = make_client()
    a, b = register(c, "alice"), register(c, "bob")
    return c, a, b


def test_sessions_are_private(duo):
    c, a, b = duo
    sid = c.post("/api/me/sessions/manual", headers=a.h,
                 json={"distance_m": 3000, "minutes": 40, "note": "secret note"}).json()["id"]
    assert [s["id"] for s in c.get("/api/me/sessions", headers=a.h).json()] == [sid]
    assert c.get("/api/me/sessions", headers=b.h).json() == []
    # B can neither edit nor delete A's session; to B it simply does not exist
    assert c.patch(f"/api/me/sessions/{sid}", headers=b.h, json={"note": "pwned"}).status_code == 404
    assert c.delete(f"/api/me/sessions/{sid}", headers=b.h).status_code == 404
    mine = c.get("/api/me/sessions", headers=a.h).json()[0]
    assert mine["note"] == "secret note"
    # B's own progress is untouched, A's counted
    assert c.get("/api/me/state", headers=b.h).json()["subject"]["progress_m"] == 0
    assert c.get("/api/me/state", headers=a.h).json()["subject"]["progress_m"] == 3000


def test_packs_and_collection_are_private(duo):
    c, a, b = duo
    pack_a = c.get("/api/me/packs", headers=a.h).json()["unopened"][0]["id"]
    r = c.post(f"/api/me/packs/{pack_a}/open", headers=b.h)
    assert r.status_code == 404
    assert len(c.get("/api/me/packs", headers=a.h).json()["unopened"]) == 2  # untouched
    opened = c.post(f"/api/me/packs/{pack_a}/open", headers=a.h)
    assert opened.status_code == 200 and len(opened.json()["cards"]) == 5
    assert c.get("/api/me/collection", headers=b.h).json()["owned"] == {}
    assert len(c.get("/api/me/collection", headers=a.h).json()["owned"]) == 5
    # B cannot craft A's essence into anything
    c.app.state.service.wallet.add(a.id, 500)
    assert c.get("/api/me/collection", headers=b.h).json()["essence"] == 0
    assert c.get("/api/me/collection", headers=a.h).json()["essence"] == 500


def test_notifications_are_private(duo):
    c, a, b = duo
    notes_a = c.get("/api/me/notifications", headers=a.h).json()
    assert notes_a and not c.get("/api/me/notifications", headers=b.h).json() == notes_a
    ids = [n["id"] for n in notes_a]
    r = c.post("/api/me/notifications/read", headers=b.h, json={"ids": ids})
    assert r.status_code == 200
    assert all(not n["read"] for n in c.get("/api/me/notifications", headers=a.h).json())
    assert c.post("/api/me/notifications/read", headers=a.h, json={"all": True}).json()["unread"] == 0


def test_legacy_unscoped_routes_are_gone(duo):
    c, a, b = duo
    for method, path in [
        ("GET", "/api/state"), ("GET", "/api/users"), ("POST", "/api/users"),
        ("GET", "/api/sessions"), ("POST", "/api/sessions/start"),
        ("POST", "/api/sessions/stop"), ("POST", "/api/sessions/manual"),
        ("POST", "/api/adjustments"), ("POST", "/api/choice"),
        ("GET", f"/api/users/{a.id}/journal"), ("GET", f"/api/users/{a.id}/daily"),
        ("GET", f"/api/users/{a.id}/streak"), ("GET", "/api/party/journal"),
        ("PATCH", f"/api/users/{a.id}"), ("DELETE", f"/api/users/{a.id}"),
        ("PATCH", "/api/sessions/1"), ("DELETE", "/api/sessions/1"),
    ]:
        r = c.request(method, path, headers=b.h, json={} if method != "GET" else None)
        assert r.status_code in (404, 405), (method, path, r.status_code)
    assert c.get("/api/me/state", headers=a.h).json().get("party") is None
    assert "subjects" not in c.get("/api/me/state", headers=a.h).json()


def test_snapshot_never_exposes_another_players_walk(duo):
    c, a, b = duo
    assert c.post("/api/me/walk/start", headers=a.h).status_code == 200
    c.post("/api/dev/sim", headers=a.h, json={"speed_kmh": 6})
    time.sleep(0.8)
    snap_b = c.get("/api/me/state", headers=b.h).json()
    assert snap_b["session"] is None
    assert snap_b["treadmill"]["busy"] is True
    assert snap_b["treadmill"]["walker"]["id"] == a.id
    assert snap_b["subject"]["id"] == b.id and snap_b["me"]["id"] == b.id
    walker = str(snap_b["treadmill"])
    for leak in ("telemetry", "heart_rate", "incline", "started_at", "daily_goal", "handicap",
                 "pending_choice", "password"):
        assert leak not in walker, leak
    assert "telemetry" not in str(snap_b) and "heart_rate" not in str(snap_b)
    assert c.get("/api/me/state", headers=a.h).json()["session"]["telemetry"]
    # B is locked out of A's walk
    assert c.post("/api/me/walk/start", headers=b.h).status_code == 409
    assert c.post("/api/me/walk/start", headers=b.h).json()["code"] == "treadmill_busy"
    for op in ("pause", "resume", "stop"):
        r = c.post(f"/api/me/walk/{op}", headers=b.h)
        assert r.status_code == 403, op
    assert c.post("/api/me/walk/choice", headers=b.h,
                  json={"event_id": "x", "option_id": "y"}).status_code == 403
    assert c.post("/api/me/walk/stop", headers=a.h).status_code == 200


def test_session_cannot_be_deleted_while_live(duo):
    c, a, _ = duo
    c.post("/api/me/walk/start", headers=a.h)
    sid = c.get("/api/me/sessions", headers=a.h).json()[0]["id"]
    assert c.delete(f"/api/me/sessions/{sid}", headers=a.h).status_code == 409
    c.post("/api/me/walk/stop", headers=a.h)


def test_public_profile_and_live_are_minimal(duo):
    c, a, b = duo
    c.post("/api/me/sessions/manual", headers=a.h, json={"distance_m": 1500, "minutes": 20,
                                                          "note": "private diary"})
    prof = c.get(f"/api/users/{a.id}/profile", headers=b.h).json()
    assert prof["id"] == a.id and prof["username"] == "alice"
    text = str(prof)
    for secret in ("private diary", "password", "token", "handicap", "daily_goal", "email"):
        assert secret not in text
    assert "recent_rares" in prof
    assert c.get("/api/users/9999/profile", headers=b.h).status_code == 404
    c.post("/api/me/walk/start", headers=a.h)
    live = c.get("/api/live", headers=b.h).json()
    assert len(live) == 1 and live[0]["profile"]["id"] == a.id
    assert set(live[0]) == {"profile", "speed_kmh", "session_distance_m"}
    c.post("/api/me/walk/stop", headers=a.h)


def test_admin_routes_are_admin_only(duo):
    c, a, b = duo   # alice registered first -> admin
    assert c.get("/api/admin/users", headers=b.h).status_code == 403
    assert c.patch(f"/api/admin/users/{a.id}", headers=b.h, json={"handicap": 3}).status_code == 403
    assert c.delete(f"/api/admin/users/{a.id}", headers=b.h).status_code == 403
    assert c.post("/api/admin/adjustments", headers=b.h,
                  json={"user_id": a.id, "delta_m": 10}).status_code == 403
    users = c.get("/api/admin/users", headers=a.h).json()
    assert {u["username"] for u in users} == {"alice", "bob"}
    assert "password_hash" not in str(users) and "scrypt" not in str(users)
    assert c.patch(f"/api/admin/users/{b.id}", headers=a.h, json={"handicap": 2}).json()["handicap"] == 2
    assert c.delete(f"/api/admin/users/{a.id}", headers=a.h).status_code == 400  # not yourself
    assert c.delete(f"/api/admin/users/{b.id}", headers=a.h).status_code == 200
    assert c.get("/api/auth/me", headers=b.h).status_code == 401  # tokens cascade away


def test_push_subscriptions_are_per_user(duo):
    c, a, b = duo
    svc = c.app.state.service
    svc.push._sender = lambda info, body: None
    sub = {"endpoint": "https://push.example.org/abc", "keys": {"p256dh": "k", "auth": "s"}}
    assert c.post("/api/me/push/subscribe", headers=a.h, json=sub).status_code == 200
    assert c.get("/api/me", headers=a.h).json()["push"]["subscribed"] is True
    assert c.get("/api/me", headers=b.h).json()["push"]["subscribed"] is False
    assert c.delete("/api/me/push/subscribe", headers=b.h).json()["removed"] == 0
    assert c.get("/api/me", headers=a.h).json()["push"]["subscribed"] is True
    assert c.delete("/api/me/push/subscribe", headers=a.h).json()["removed"] == 1


def test_cannot_read_another_users_data_by_id_anywhere(duo):
    """No /api/me route accepts a user id; ids in the path only ever address the caller's rows."""
    c, a, b = duo
    for route in c.app.routes:
        path = getattr(route, "path", "")
        if path.startswith("/api/me"):
            assert "user_id" not in path
    r = c.get(f"/api/me/sessions?user_id={a.id}", headers=b.h)
    assert r.json() == []
