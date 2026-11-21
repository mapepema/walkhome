"""Notifications, Web Push quota/cleanup and the 19:00 streak reminder."""

import json
from datetime import datetime, timezone

import pytest

from app import push as push_module
from app.errors import WalkhomeError
from app.notifications import streak_risk_job


@pytest.fixture()
def pushed(env):
    sent = []
    env.svc.push._sender = lambda info, body: sent.append((info["endpoint"], json.loads(body)))
    return sent


def subscribe(env, uid, endpoint="https://push.example.org/dev1"):
    env.svc.push.subscribe(uid, endpoint, "p256dh-key", "auth-secret")


def test_notifications_stored_listed_and_marked_read(env):
    u = env.user("nt1")
    n = env.svc.notifier.create(u["id"], "system", "Hello", "World", "👋", {"url": "/x"})
    assert n["read"] is False and n["data"] == {"url": "/x"}
    assert env.svc.notifier.unread_count(u["id"]) == 2  # + welcome
    listed = env.svc.notifier.list(u["id"])
    assert listed[0]["title"] == "Hello"  # newest first
    assert env.svc.notifier.mark_read(u["id"], ids=[n["id"]]) == 1
    assert env.svc.notifier.mark_read(u["id"], all_=True) == 0
    assert (u["id"], "notify") in [(uid, t) for uid, t, _ in env.svc.outbox]


def test_push_requires_subscription_and_delivers_payload(env, pushed):
    u = env.user("ps1")
    env.svc.notifier.create(u["id"], "system", "no sub", push=True)
    assert pushed == []
    subscribe(env, u["id"])
    env.svc.notifier.create(u["id"], "pack", "Hello", "Body", "🎁", {"url": "/packs"})
    assert len(pushed) == 1
    endpoint, payload = pushed[0]
    assert endpoint == "https://push.example.org/dev1"
    assert payload["title"] == "Hello" and payload["data"]["url"] == "/packs"


def test_push_quota_is_6_per_day_then_resets(env, pushed):
    u = env.user("ps2")
    subscribe(env, u["id"])
    for i in range(9):
        env.svc.notifier.create(u["id"], "system", f"n{i}")
    assert len(pushed) == 6
    # in-app notifications are not limited
    assert len(env.svc.notifier.list(u["id"], 50)) == 9 + 1
    env.clock.advance(days=1)
    env.svc.notifier.create(u["id"], "system", "tomorrow")
    assert len(pushed) == 7


def test_gone_subscription_is_removed(env):
    u = env.user("ps3")

    class Gone(Exception):
        response = type("R", (), {"status_code": 410})()

    def boom(info, body):
        raise Gone()

    env.svc.push._sender = boom
    subscribe(env, u["id"])
    assert env.svc.push.is_subscribed(u["id"])
    env.svc.notifier.create(u["id"], "system", "x")
    assert not env.svc.push.is_subscribed(u["id"])


def test_endpoint_validation_blocks_ssrf(env, pushed):
    u = env.user("ps4")
    for bad in ("http://example.org/x", "https://localhost/x", "https://127.0.0.1/x",
                "https://192.168.1.5/x", "ftp://x", "javascript:alert(1)", "https:///x"):
        with pytest.raises(WalkhomeError) as e:
            env.svc.push.subscribe(u["id"], bad, "k", "a")
        assert e.value.code == "bad_endpoint", bad
    subscribe(env, u["id"])


def test_without_pywebpush_everything_degrades(env, monkeypatch):
    monkeypatch.setattr(push_module, "HAVE_WEBPUSH", False)
    svc = env.svc
    svc.push._sender, svc.push._public_key, svc.push._tried = None, None, False
    u = env.user("ps5")
    assert svc.push.supported is False
    me = svc.me_view(svc.get_user(u["id"]))
    assert me["push"] == {"supported": False, "subscribed": False}
    with pytest.raises(WalkhomeError) as e:
        svc.push.subscribe(u["id"], "https://push.example.org/x", "k", "a")
    assert e.value.code == "push_unsupported"
    svc.notifier.create(u["id"], "system", "still works")   # no exception
    assert svc.notifier.list(u["id"])[0]["title"] == "still works"


def test_vapid_keys_generated_once(env, tmp_path):
    env.cfg.vapid_path = tmp_path / "vapid.json"
    env.svc.push._tried, env.svc.push._public_key = False, None
    key = env.svc.push.public_key
    assert key and env.cfg.vapid_path.exists()
    data = json.loads(env.cfg.vapid_path.read_text())
    assert data["public_key"] == key and "BEGIN" in data["private_pem"]
    env.svc.push._tried, env.svc.push._public_key = False, None
    assert env.svc.push.public_key == key  # reloaded, not regenerated


def test_streak_risk_job_at_19h_local(env):
    walker, lazy, fresh = env.user("sr1"), env.user("sr2"), env.user("sr3")
    for d in (1, 2, 3):                          # streak of 3 ending yesterday, nothing today
        env.session_row(walker["id"], 500, days_ago=d)
    for d in (0, 1, 2):                          # walked today -> safe
        env.session_row(lazy["id"], 500, days_ago=d)
    # 12:00 Paris: too early
    assert streak_risk_job(env.db, env.svc.stats, env.svc.notifier, env.cfg, env.clock) == 0
    env.clock.now = datetime(2026, 10, 14, 17, 30, tzinfo=timezone.utc)  # 19:30 Paris (CEST)
    assert streak_risk_job(env.db, env.svc.stats, env.svc.notifier, env.cfg, env.clock) == 1
    risk = [n for n in env.svc.notifier.list(walker["id"]) if n["kind"] == "streak_risk"]
    assert len(risk) == 1 and risk[0]["data"]["streak_days"] == 3
    assert not [n for n in env.svc.notifier.list(lazy["id"]) if n["kind"] == "streak_risk"]
    assert not [n for n in env.svc.notifier.list(fresh["id"]) if n["kind"] == "streak_risk"]
    # once per day
    assert streak_risk_job(env.db, env.svc.stats, env.svc.notifier, env.cfg, env.clock) == 0
    env.clock.advance(days=1)
    assert streak_risk_job(env.db, env.svc.stats, env.svc.notifier, env.cfg, env.clock) in (0, 1)
