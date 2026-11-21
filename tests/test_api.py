"""HTTP surface through the real app with the simulator running."""

import time

import pytest

from tests.conftest import build_catalog, register


@pytest.fixture()
def api(make_client):
    c = make_client()
    return c, register(c, "walker1")


def test_health_is_public(make_client):
    c = make_client()
    h = c.get("/api/health").json()
    assert h["ok"] is True and h["telemetry"]["kind"] == "sim"


def test_themes_public_listing(make_client):
    c = make_client()
    themes = {t["id"]: t for t in c.get("/api/themes").json()}
    assert set(themes) >= {"camino", "plainpeak"}
    assert themes["camino"]["card_count"] == 17 and themes["camino"]["has_catalog"]
    assert themes["plainpeak"]["card_count"] == 0 and not themes["plainpeak"]["has_catalog"]
    assert themes["camino"]["pack_every_m"] == 2000
    assert themes["camino"]["total_m"] == 780_000


def test_theme_catalog_endpoint_with_etag(make_client):
    c = make_client()
    r = c.get("/api/themes/camino/cards")
    assert r.status_code == 200
    body = r.json()
    assert body["theme"] == "camino" and len(body["cards"]) == 17 and len(body["sets"]) == 2
    assert body["pack"]["cards_per_pack"] == 5 and body["pack"]["pity"]["ultra_every"] == 25
    assert "max-age=3600" in r.headers["cache-control"]
    etag = r.headers["etag"]
    again = c.get("/api/themes/camino/cards", headers={"If-None-Match": etag})
    assert again.status_code == 304


def test_missing_catalog_is_a_clean_404(make_client):
    c = make_client()
    r = c.get("/api/themes/plainpeak/cards")
    assert r.status_code == 404 and r.json()["code"] == "catalog_unavailable"
    r = c.get("/api/themes/nope/cards")
    assert r.status_code == 404 and r.json()["code"] == "unknown_theme"
    p = register(c, "ember1", journey="plainpeak")
    pack = c.get("/api/me/packs", headers=p.h).json()["unopened"][0]
    r = c.post(f"/api/me/packs/{pack['id']}/open", headers=p.h)
    assert r.status_code == 404 and r.json()["code"] == "catalog_unavailable"
    assert len(c.get("/api/me/packs", headers=p.h).json()["unopened"]) == 2


def test_journey_endpoints_need_a_session(api):
    c, p = api
    assert c.get("/api/journeys").status_code == 401
    packs = c.get("/api/journeys", headers=p.h).json()
    assert {x["id"] for x in packs} >= {"camino", "plainpeak"}
    assert c.get("/api/journeys/camino", headers=p.h).json()["total_m"] == 780_000
    assert c.get("/api/journeys/nope", headers=p.h).status_code == 404


def test_full_walk_over_http(api):
    c, p = api
    r = c.post("/api/me/walk/start", headers=p.h, json={})
    assert r.status_code == 200 and r.json()["user"]["display_name"] == "walker1"
    c.post("/api/dev/sim", headers=p.h, json={"speed_kmh": 8.0})
    deadline, distance = time.time() + 10, 0.0
    while time.time() < deadline:
        snap = c.get("/api/me/state", headers=p.h).json()["session"]
        distance = snap["telemetry"]["distance_m"] if snap else 0.0
        if distance > 1.0:
            break
        time.sleep(0.3)
    assert distance > 1.0, "simulator produced no distance"
    assert c.post("/api/me/walk/pause", headers=p.h).json()["manual_pause"] is True
    assert c.post("/api/me/walk/resume", headers=p.h).json()["manual_pause"] is False
    stopped = c.post("/api/me/walk/stop", headers=p.h, json={"note": "test walk"})
    assert stopped.status_code == 200 and stopped.json()["distance_m"] > 0
    sessions = c.get("/api/me/sessions", headers=p.h).json()
    assert len(sessions) == 1 and sessions[0]["note"] == "test walk"
    assert c.post("/api/me/walk/stop", headers=p.h).json()["code"] == "no_walk"
    # editing the note works, other fields are not editable
    sid = sessions[0]["id"]
    assert c.patch(f"/api/me/sessions/{sid}", headers=p.h, json={"note": "edited"}
                   ).json()["note"] == "edited"
    assert c.delete(f"/api/me/sessions/{sid}", headers=p.h).json() == {"deleted": sid}
    assert c.get("/api/me/sessions", headers=p.h).json() == []


def test_sim_dropout_and_reset_recovery(api):
    c, p = api
    c.post("/api/me/walk/start", headers=p.h)
    c.post("/api/dev/sim", headers=p.h, json={"speed_kmh": 10.0})
    time.sleep(2.5)
    c.post("/api/dev/sim", headers=p.h, json={"drop_link_s": 2.0, "reset_console": True})
    time.sleep(4.5)
    summary = c.post("/api/me/walk/stop", headers=p.h).json()
    assert 0 < summary["distance_m"] < 40


def test_dev_sim_requires_admin_or_dev_flag(make_client):
    c = make_client(dev_endpoints=False)
    admin, user = register(c, "adm1"), register(c, "usr1")
    assert c.post("/api/dev/sim", headers=user.h, json={"speed_kmh": 5}).status_code == 403
    assert c.post("/api/dev/sim", headers=admin.h, json={"speed_kmh": 5}).status_code == 200
    assert c.post("/api/dev/sim", json={"speed_kmh": 5}).status_code == 401


def test_profile_update_validation(api):
    c, p = api
    r = c.patch("/api/me", headers=p.h, json={"display_name": "Walker One", "color": "#112233",
                                              "units": "mi", "daily_goal_m": 5000,
                                              "journey_id": "plainpeak"})
    assert r.status_code == 200
    me = r.json()
    assert (me["display_name"], me["color"], me["units"], me["journey_id"]) == (
        "Walker One", "#112233", "mi", "plainpeak")
    assert c.patch("/api/me", headers=p.h, json={"color": "red"}).status_code == 422
    assert c.patch("/api/me", headers=p.h, json={"units": "furlongs"}).status_code == 422
    assert c.patch("/api/me", headers=p.h, json={"journey_id": "nowhere"}).status_code == 400
    # handicap is not self-service
    assert c.patch("/api/me", headers=p.h, json={"handicap": 10}).json()["handicap"] == 1.0
    # progress is per theme
    c.post("/api/me/sessions/manual", headers=p.h, json={"distance_m": 1000, "minutes": 15})
    assert c.get("/api/me/state", headers=p.h).json()["subject"]["progress_m"] == 1000
    c.patch("/api/me", headers=p.h, json={"journey_id": "camino"})
    assert c.get("/api/me/state", headers=p.h).json()["subject"]["progress_m"] == 0


def test_display_name_conflict(make_client):
    c = make_client()
    a, b = register(c, "name_a"), register(c, "name_b")
    r = c.patch("/api/me", headers=b.h, json={"display_name": "name_a"})
    assert r.status_code == 409 and r.json()["code"] == "display_name_taken"


def test_cannot_change_theme_mid_walk(api):
    c, p = api
    c.post("/api/me/walk/start", headers=p.h)
    r = c.patch("/api/me", headers=p.h, json={"journey_id": "plainpeak"})
    assert r.status_code == 409 and r.json()["code"] == "walk_in_progress"
    c.post("/api/me/walk/stop", headers=p.h)


def test_manual_session_validation(api):
    c, p = api
    for body in ({"distance_m": 0}, {"distance_m": -5}, {"distance_m": 10**7},
                 {"distance_m": 500, "when_utc": "2099-01-01T00:00:00Z"}):
        assert c.post("/api/me/sessions/manual", headers=p.h, json=body).status_code in (400, 422)


def test_packs_open_collection_craft_economy_over_http(api):
    c, p = api
    packs = c.get("/api/me/packs", headers=p.h).json()
    assert len(packs["unopened"]) == 2 and packs["pack_every_m"] == 2000
    assert packs["next_pack_in_m"] == 2000 and packs["opened_count"] == 0
    grant = packs["unopened"][0]
    assert set(grant) == {"id", "theme", "source", "source_key", "title", "created_utc",
                          "opened_utc"}
    res = c.post(f"/api/me/packs/{grant['id']}/open", headers=p.h).json()
    assert len(res["cards"]) == 5 and {"card", "is_new", "count", "essence_gained"} <= set(res["cards"][0])
    assert c.post(f"/api/me/packs/{grant['id']}/open", headers=p.h).status_code == 409
    coll = c.get("/api/me/collection", headers=p.h).json()
    assert coll["theme"] == "camino" and len(coll["owned"]) == 5 and set(coll["completion"]) == {"s1", "s2"}
    eco = c.get("/api/me/economy", headers=p.h).json()
    assert eco["craft_cost"]["secret"] is None and eco["dup_essence"]["rare"] == 25
    missing = next(x for x in build_catalog()["cards"]
                   if x["id"] not in coll["owned"] and x["rarity"] == "common")
    assert c.post("/api/me/craft", headers=p.h, json={"card_id": missing["id"]}
                  ).json()["code"] == "not_enough_essence"
    c.app.state.service.wallet.add(p.id, 100)
    crafted = c.post("/api/me/craft", headers=p.h, json={"card_id": missing["id"]}).json()
    assert crafted["essence"] == 100 - eco["craft_cost"]["common"]


def test_quests_and_claims_over_http(api):
    c, p = api
    qs = c.get("/api/me/quests", headers=p.h).json()
    assert any(q["id"] == "d_walk_2km" for q in qs)
    assert c.post("/api/me/quests/d_walk_2km/claim", headers=p.h).status_code == 400
    c.post("/api/me/sessions/manual", headers=p.h, json={"distance_m": 2500, "minutes": 30})
    out = c.post("/api/me/quests/d_walk_2km/claim", headers=p.h).json()
    assert len(out["granted"]) == 1
    assert c.post("/api/me/quests/d_walk_2km/claim", headers=p.h).status_code == 409


def test_leaderboard_over_http(make_client):
    c = make_client()
    a, b = register(c, "lead_a"), register(c, "lead_b")
    c.post("/api/me/sessions/manual", headers=a.h, json={"distance_m": 5000, "minutes": 60})
    c.post("/api/me/sessions/manual", headers=b.h, json={"distance_m": 3000, "minutes": 40})
    lb = c.get("/api/leaderboard?period=week", headers=b.h).json()
    assert lb["journey_id"] == "camino" and lb["me_rank"] == 2 and lb["total"] == 2
    assert [r["profile"]["username"] for r in lb["rows"]] == ["lead_a", "lead_b"]
    assert lb["rows"][1]["is_me"] and lb["rows"][1]["gap_to_next_m"] == 2000
    assert c.get("/api/leaderboard?period=all&journey_id=plainpeak", headers=b.h).json()["rows"] == []
    assert c.get("/api/leaderboard?period=bad", headers=b.h).status_code == 400
    assert c.get("/api/leaderboard?journey_id=nope", headers=b.h).status_code == 404


def test_journal_daily_streak(api):
    c, p = api
    c.post("/api/me/sessions/manual", headers=p.h, json={"distance_m": 10000, "minutes": 120})
    assert any(j["icon"] == "🐚" for j in c.get("/api/me/journal", headers=p.h).json())
    daily = c.get("/api/me/daily", headers=p.h).json()
    assert daily and daily[-1]["distance_m"] == 10000
    assert c.get("/api/me/streak", headers=p.h).json()["days"] >= 1


def test_notifications_flow(api):
    c, p = api
    notes = c.get("/api/me/notifications", headers=p.h).json()
    assert notes and notes[0]["kind"] == "pack" and notes[0]["read"] is False
    assert set(notes[0]) >= {"id", "kind", "title", "body", "icon", "created_utc", "read"}
    assert c.get("/api/me/state", headers=p.h).json()["unread_notifications"] == len(notes)
    out = c.post("/api/me/notifications/read", headers=p.h, json={"ids": [notes[0]["id"]]}).json()
    assert out["unread"] == len(notes) - 1
    assert c.post("/api/me/notifications/read", headers=p.h, json={"all": True}).json()["unread"] == 0


def test_push_vapid_endpoint(api):
    c, p = api
    out = c.get("/api/me/push/vapid", headers=p.h).json()
    assert out["public_key"] and len(out["public_key"]) > 60  # urlsafe b64 P-256 point
    bad = c.post("/api/me/push/subscribe", headers=p.h,
                 json={"endpoint": "http://localhost/x", "keys": {"p256dh": "a", "auth": "b"}})
    assert bad.status_code == 400 and bad.json()["code"] == "bad_endpoint"
