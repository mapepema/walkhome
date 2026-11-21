"""Accounts: registration, scrypt, hashed tokens, cookie/Bearer, throttling."""

import hashlib
from datetime import timedelta

import pytest
from starlette.websockets import WebSocketDisconnect

from app import auth as auth_module
from app.auth import AuthService, hash_password, verify_password
from app.errors import WalkhomeError
from tests.conftest import PASSWORD, START, FakeClock, register


def test_scrypt_hash_roundtrip():
    h = hash_password("s3cret-pass")
    assert h.startswith("scrypt$") and "s3cret-pass" not in h
    assert verify_password("s3cret-pass", h)
    assert not verify_password("S3cret-pass", h)
    assert not verify_password("x", "garbage")
    assert hash_password("s3cret-pass") != h  # salted


def test_register_sets_httponly_lax_cookie_and_returns_me(make_client):
    c = make_client()
    r = c.post("/api/auth/register", json={
        "username": "Alice", "password": PASSWORD, "journey_id": "camino",
        "avatar": "🦊", "color": "#aabbcc"})
    assert r.status_code == 200
    me = r.json()
    assert me["username"] == "Alice" and me["avatar"] == "🦊" and me["color"] == "#aabbcc"
    assert me["is_admin"] is True and me["wallet"] == {"essence": 0}
    assert me["unopened_packs"] == 2 and me["journey_id"] == "camino"
    assert "password" not in str(me)
    cookie = r.headers["set-cookie"].lower()
    assert "wh_session=" in cookie and "httponly" in cookie and "samesite=lax" in cookie
    assert "secure" not in cookie
    assert c.get("/api/auth/me").json()["id"] == me["id"]  # the cookie jar works


def test_secure_cookie_behind_https_proxy(make_client):
    c = make_client()
    r = c.post("/api/auth/register", headers={"x-forwarded-proto": "https"}, json={
        "username": "secure1", "password": PASSWORD, "journey_id": "camino"})
    assert "secure" in r.headers["set-cookie"].lower()


def test_first_account_is_admin_second_is_not(make_client):
    c = make_client()
    a, b = register(c, "first1"), register(c, "second1")
    assert a.me["is_admin"] is True and b.me["is_admin"] is False


def test_username_rules_and_case_insensitive_uniqueness(make_client):
    c = make_client()
    register(c, "Alice")
    r = c.post("/api/auth/register", json={"username": "alice", "password": PASSWORD,
                                           "journey_id": "camino"})
    assert r.status_code == 409 and r.json()["code"] == "username_taken"
    for bad in ("ab", "x" * 25, "has space", "ñ-accent", "a/b"):
        r = c.post("/api/auth/register", json={"username": bad, "password": PASSWORD,
                                               "journey_id": "camino"})
        assert r.status_code == 400 and r.json()["code"] == "bad_username", bad
    r = c.post("/api/auth/register", json={"username": "okname", "password": "short",
                                           "journey_id": "camino"})
    assert r.status_code == 400 and r.json()["code"] == "weak_password"
    r = c.post("/api/auth/register", json={"username": "okname", "password": PASSWORD,
                                           "journey_id": "nowhere"})
    assert r.status_code == 400 and r.json()["code"] == "unknown_theme"


def test_only_the_token_hash_is_stored(make_client):
    c = make_client()
    p = register(c, "hashy1")
    rows = c.app.state.db.query("SELECT token_hash FROM auth_tokens")
    assert len(rows) == 1
    assert rows[0]["token_hash"] == hashlib.sha256(p.token.encode()).hexdigest()
    assert p.token not in rows[0]["token_hash"]
    user = c.app.state.db.query_one("SELECT password_hash FROM users")
    assert user["password_hash"].startswith("scrypt$") and PASSWORD not in user["password_hash"]


def test_bearer_cookie_logout_and_bad_token(make_client):
    c = make_client()
    p = register(c, "bear1")
    assert c.get("/api/auth/me").status_code == 401  # jar was cleared
    assert c.get("/api/auth/me", headers=p.h).json()["id"] == p.id
    assert c.get("/api/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    c.cookies.set("wh_session", p.token)
    assert c.get("/api/auth/me").status_code == 200
    assert c.post("/api/auth/logout").json() == {"ok": True}
    c.cookies.clear()
    assert c.get("/api/auth/me", headers=p.h).status_code == 401  # revoked server-side


def test_login_and_wrong_password_do_not_leak_which_part_failed(make_client):
    c = make_client()
    register(c, "login1")
    ok = c.post("/api/auth/login", json={"username": "LOGIN1", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["username"] == "login1"
    bad_pw = c.post("/api/auth/login", json={"username": "login1", "password": "wrong-password"})
    bad_user = c.post("/api/auth/login", json={"username": "nobody1", "password": "wrong-password"})
    assert bad_pw.status_code == bad_user.status_code == 401
    assert bad_pw.json() == bad_user.json()


def test_login_rate_limit(make_client):
    c = make_client()
    register(c, "rate1")
    for _ in range(5):
        assert c.post("/api/auth/login", json={"username": "rate1", "password": "bad-password"}
                      ).status_code == 401
    r = c.post("/api/auth/login", json={"username": "rate1", "password": PASSWORD})
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert int(r.headers["retry-after"]) >= 1
    # another account from the same address is not locked out
    register(c, "rate2")
    assert c.post("/api/auth/login", json={"username": "rate2", "password": PASSWORD}
                  ).status_code == 200


def test_rate_limit_window_expires():
    now = [0.0]
    lim = auth_module.LoginLimiter(5, 60.0, now=lambda: now[0])
    for _ in range(5):
        lim.failure("1.1.1.1", "u")
    with pytest.raises(WalkhomeError):
        lim.check("1.1.1.1", "u")
    now[0] = 61.0
    lim.check("1.1.1.1", "u")


def test_invite_mode(make_client):
    c = make_client(registration="invite", invite_code="open-sesame")
    body = {"username": "invitee", "password": PASSWORD, "journey_id": "camino"}
    assert c.post("/api/auth/register", json=body).status_code == 403
    assert c.post("/api/auth/register", json={**body, "invite_code": "wrong"}).status_code == 403
    assert c.post("/api/auth/register", json={**body, "invite_code": "open-sesame"}
                  ).status_code == 200


def test_closed_or_unconfigured_invite_registration(make_client):
    c = make_client(registration="invite", invite_code="")
    r = c.post("/api/auth/register", json={"username": "nobody1", "password": PASSWORD,
                                           "journey_id": "camino", "invite_code": ""})
    assert r.status_code == 403
    c2 = make_client(registration="closed")
    assert c2.post("/api/auth/register", json={"username": "nobody1", "password": PASSWORD,
                                               "journey_id": "camino"}).status_code == 403


def test_sliding_session_expiry(env):
    u = env.user("slide1")
    token = env.svc.auth.issue_token(u["id"])
    assert env.svc.auth.authenticate(token)["id"] == u["id"]
    env.clock.advance(days=80)
    assert env.svc.auth.authenticate(token) is not None  # refreshed: expiry moves out
    env.clock.advance(days=80)
    assert env.svc.auth.authenticate(token) is not None
    env.clock.advance(days=91)  # untouched for longer than 90 days
    assert env.svc.auth.authenticate(token) is None
    assert env.db.query_one("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id=?",
                            (u["id"],))["n"] == 0


def test_change_password_signs_out_other_devices(make_client):
    c = make_client()
    p = register(c, "chg1")
    other = c.post("/api/auth/login", json={"username": "chg1", "password": PASSWORD}
                   ).cookies.get("wh_session")
    c.cookies.clear()
    assert c.post("/api/me/password", headers=p.h, json={"old": "wrong-old-pass", "new": "n3w-passw0rd"}
                  ).status_code == 403
    assert c.post("/api/me/password", headers=p.h, json={"old": PASSWORD, "new": "short"}
                  ).status_code == 400
    assert c.post("/api/me/password", headers=p.h, json={"old": PASSWORD, "new": "n3w-passw0rd"}
                  ).status_code == 200
    assert c.get("/api/auth/me", headers=p.h).status_code == 200
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "chg1", "password": "n3w-passw0rd"}
                  ).status_code == 200


def test_every_private_route_requires_a_session(make_client):
    c = make_client()
    public = {"/api/health", "/api/themes", "/api/themes/{theme_id}/cards",
              "/api/auth/register", "/api/auth/login", "/api/auth/claim", "/api/auth/logout"}
    checked = 0
    for route in c.app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in public:
            continue
        concrete = path.replace("{user_id}", "1").replace("{session_id}", "1") \
            .replace("{pack_id}", "1").replace("{quest_id}", "q").replace("{journey_id}", "camino")
        for method in route.methods - {"HEAD", "OPTIONS"}:
            r = c.request(method, concrete)
            assert r.status_code == 401, (method, path, r.status_code)
            checked += 1
    assert checked > 30


def test_websocket_without_session_closes_4401(make_client):
    c = make_client()
    with c.websocket_connect("/ws") as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401


def test_websocket_with_bad_token_closes_4401(make_client):
    c = make_client()
    with c.websocket_connect("/ws", headers={"Authorization": "Bearer nope"}) as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
        assert e.value.code == 4401


def test_registration_is_rate_limited_per_ip(make_client):
    c = make_client(register_max_per_hour=3)
    for i in range(3):
        register(c, f"spam_{i}")
    r = c.post("/api/auth/register", json={"username": "spam_9", "password": PASSWORD,
                                           "journey_id": "camino"})
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
