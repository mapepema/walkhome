"""The WebSocket is per-user: private messages never reach anyone else."""

import time

import pytest

from app import service as service_module
from tests.conftest import register

PRIVATE = {"snapshot", "tick", "reward", "notify", "rank", "event", "challenge"}


@pytest.fixture()
def duo(make_client, monkeypatch):
    monkeypatch.setattr(service_module, "LIVE_EVERY_S", 0.2)
    c = make_client()
    return c, register(c, "wsa"), register(c, "wsb")


def collect(ws, n=12):
    return [ws.receive_json() for _ in range(n)]


def test_connect_sends_own_snapshot_then_live(duo):
    c, a, b = duo
    with c.websocket_connect("/ws", headers=a.h) as ws:
        first, second = ws.receive_json(), ws.receive_json()
    assert first["type"] == "snapshot" and first["data"]["me"]["id"] == a.id
    assert first["data"]["session"] is None
    assert second["type"] == "live" and second["data"] == {"walkers": []}
    assert {"type", "seq", "server_time", "data"} <= set(first)


def test_tick_and_session_state_only_reach_the_walker(duo):
    c, a, b = duo
    with c.websocket_connect("/ws", headers=a.h) as wa, c.websocket_connect("/ws", headers=b.h) as wb:
        wa.receive_json(); wb.receive_json()
        assert c.post("/api/me/walk/start", headers=a.h).status_code == 200
        c.post("/api/dev/sim", headers=a.h, json={"speed_kmh": 6})
        msgs_a = collect(wa, 14)
        msgs_b = collect(wb, 14)
    types_a = {m["type"] for m in msgs_a}
    assert "tick" in types_a and "snapshot" in types_a
    tick = next(m for m in msgs_a if m["type"] == "tick")
    assert tick["data"]["me"]["id"] == a.id and tick["data"]["session"]["user"]["id"] == a.id
    assert tick["data"]["treadmill"]["walker"]["id"] == a.id
    # B: only public presence, never a tick, never A's session or telemetry
    assert {m["type"] for m in msgs_b} <= {"live"}
    walkers = [m["data"]["walkers"] for m in msgs_b if m["data"]["walkers"]]
    assert walkers and set(walkers[0][0]) == {"user_id", "display_name", "avatar", "color",
                                              "speed_kmh"}
    assert walkers[0][0]["user_id"] == a.id
    assert "telemetry" not in str(msgs_b) and "heart_rate" not in str(msgs_b)
    c.post("/api/me/walk/stop", headers=a.h)


def test_rewards_and_notifications_are_addressed(duo):
    c, a, b = duo
    with c.websocket_connect("/ws", headers=a.h) as wa, c.websocket_connect("/ws", headers=b.h) as wb:
        wa.receive_json(); wa.receive_json(); wb.receive_json(); wb.receive_json()
        c.post("/api/me/sessions/manual", headers=a.h, json={"distance_m": 4500, "minutes": 55})
        got_a = collect(wa, 10)
        got_b = collect(wb, 10)
    private_a = [m for m in got_a if m["type"] in PRIVATE]
    assert {"reward", "notify"} <= {m["type"] for m in private_a}
    reward = next(m for m in private_a if m["type"] == "reward")["data"]
    assert reward["grants"] and reward["reason"] and reward["title"]
    assert all(g["source"] in ("distance", "daily") for g in reward["grants"])
    assert not [m for m in got_b if m["type"] in PRIVATE]


def test_resync_returns_a_fresh_private_snapshot(duo):
    c, a, b = duo
    with c.websocket_connect("/ws", headers=b.h) as ws:
        ws.receive_json(); ws.receive_json()
        ws.send_text("resync")
        msgs = collect(ws, 4)
    snaps = [m for m in msgs if m["type"] == "snapshot"]
    assert snaps and snaps[0]["data"]["me"]["id"] == b.id


def test_events_are_private_to_the_player_who_crossed_them(duo):
    c, a, b = duo
    with c.websocket_connect("/ws", headers=a.h) as wa, c.websocket_connect("/ws", headers=b.h) as wb:
        wa.receive_json(); wb.receive_json()
        c.post("/api/admin/adjustments", headers=a.h,
               json={"user_id": a.id, "delta_m": 20000})
        got_a, got_b = collect(wa, 8), collect(wb, 8)
    assert any(m["type"] == "event" and m["data"]["subject"]["id"] == a.id for m in got_a)
    assert not [m for m in got_b if m["type"] == "event"]


def test_hub_routes_by_user(make_client):
    """Unit-level: broadcast(user_id=..) only reaches that user's sockets."""
    import asyncio
    from app.hub import Hub

    async def run():
        hub, out = Hub(), {1: [], 2: [], 3: []}

        def sender(i):
            async def send(payload):
                out[i].append(payload)
            return send

        c1 = await hub.register(sender(1), user_id=10)
        c1b = await hub.register(sender(2), user_id=10)
        c2 = await hub.register(sender(3), user_id=20)
        await hub.broadcast("tick", {"x": 1}, user_id=10)
        await hub.broadcast("live", {"y": 1})
        await asyncio.sleep(0.05)
        await hub.close()
        return out

    out = asyncio.new_event_loop().run_until_complete(run())
    assert len(out[1]) == 2 and len(out[2]) == 2 and len(out[3]) == 1
    assert '"tick"' not in out[3][0]
