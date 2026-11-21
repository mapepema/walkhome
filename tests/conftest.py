"""Shared fixtures: a content dir with a mini card catalog, a controllable clock,
a service wired without hardware, and an HTTP client factory."""

import json
import random
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth as auth_module
from app import db as db_module
from app.ble import NullTelemetrySource
from app.config import Config
from app.content import ContentLibrary
from app.db import Database
from app.ftms import TreadmillSample
from app.hub import Hub
from app.server import create_app
from app.service import WalkhomeService

ROOT = Path(__file__).resolve().parent.parent
MI_TO_M = 1609.344
PASSWORD = "correct-horse-battery"

# (rarity, how many) -> two sets
RARITY_PLAN = [("common", 6), ("uncommon", 4), ("rare", 3), ("holo", 2), ("ultra", 1), ("secret", 1)]


def build_catalog(theme="camino"):
    cards, sets = [], {"s1": [], "s2": []}
    n = 0
    for rarity, count in RARITY_PLAN:
        for i in range(count):
            set_id = "s1" if n % 2 == 0 else "s2"
            n += 1
            slug = f"{rarity}{i + 1}"
            card = {
                "id": f"{theme}:{set_id}:{slug}", "theme": theme, "set": set_id, "number": n,
                "name": f"Card {slug}", "rarity": rarity,
                "foil": "none" if rarity in ("common", "uncommon") else "linear",
                "image": f"/cards/{theme}/{set_id}/{slug}.webp",
                "thumb": f"/cards/{theme}/{set_id}/{slug}.thumb.webp",
            }
            cards.append(card)
            sets[set_id].append(card)
    return {
        "theme": theme,
        "sets": [
            {"id": sid, "theme": theme, "name": f"Set {sid}", "card_count": len(c),
             "accent": "#cc8844"} for sid, c in sets.items()
        ],
        "cards": cards,
        "pack": {
            "cards_per_pack": 5,
            "slots": [
                {"label": "c", "odds": {"common": 70, "uncommon": 30}},
                {"label": "c", "odds": {"common": 70, "uncommon": 30}},
                {"label": "c", "odds": {"common": 70, "uncommon": 30}},
                {"label": "rare", "odds": {"rare": 85, "holo": 12, "ultra": 2.8, "secret": 0.2}},
                {"label": "chance", "odds": {"uncommon": 40, "rare": 40, "holo": 15,
                                             "ultra": 4.5, "secret": 0.5}},
            ],
            "pity": {"rare_every": 5, "ultra_every": 25},
        },
    }


class FakeClock:
    def __init__(self, start):
        self.now = start

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


# Wednesday 2026-10-14 12:00 Paris (10:00 UTC): mid-week, mid-day.
START = datetime(2026, 10, 14, 10, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def fast_scrypt(monkeypatch):
    monkeypatch.setattr(auth_module, "SCRYPT_N", 2 ** 8)


@pytest.fixture(scope="session")
def content_dir(tmp_path_factory):
    """The real journey pack, a second test-only journey ('plainpeak', a copy of
    camino under another id) and a fixture card catalog for 'camino' only
    ('plainpeak' deliberately has none: its draw must stay disabled)."""
    src = ROOT / "content"
    if not (src / "camino.json").exists():
        import subprocess
        import sys
        subprocess.run([sys.executable, str(ROOT / "tools" / "build_content.py")], check=True)
    dest = tmp_path_factory.mktemp("content")
    for f in src.glob("*.json"):
        shutil.copy(f, dest / f.name)
    plain = json.loads((src / "camino.json").read_text(encoding="utf-8"))
    plain["id"] = "plainpeak"
    plain["name"] = "Plain Peak (test journey)"
    (dest / "plainpeak.json").write_text(json.dumps(plain), encoding="utf-8")
    (dest / "cards").mkdir()
    (dest / "cards" / "camino.json").write_text(json.dumps(build_catalog("camino")))
    return dest


@pytest.fixture()
def clock():
    c = FakeClock(START)
    db_module.set_clock(c)
    yield c
    db_module.set_clock(None)


def make_config(tmp_path, content_dir, name="test.db"):
    cfg = Config()
    cfg.db_path = tmp_path / name
    cfg.content_dir = content_dir
    cfg.default_pack = "camino"
    cfg.checkpoint_every_s = 0.0  # checkpoint on every tick in tests
    cfg.stats_cache_ttl_s = 0.0
    cfg.tz_name = "Europe/Paris"
    cfg.registration = "open"
    cfg.invite_code = ""
    cfg.ble_mode = "off"
    return cfg


class Env:
    """A service plus helpers to create players and push synthetic telemetry."""

    def __init__(self, svc, cfg, db, clock):
        self.svc, self.cfg, self.db, self.clock = svc, cfg, db, clock

    def user(self, name="alice", journey="camino", **kw):
        name = name if len(name) >= 3 else name + "_xx"
        return self.svc.register(username=name, password=PASSWORD, journey_id=journey, **kw)

    def feed(self, speed_kmh=6.0, seconds=60, start=0.0, total_start=None):
        for i in range(int(seconds) + 1):
            total = int(total_start + i * speed_kmh / 3.6) if total_start is not None else None
            self.svc._handle_sample(
                TreadmillSample(speed_kmh=speed_kmh, total_distance_m=total), at=start + float(i))

    def session_row(self, user_id, meters, *, days_ago=0, source="treadmill", minutes=None,
                    journey="camino"):
        """Insert a finished session straight into the DB (history fixtures)."""
        when = self.clock() - timedelta(days=days_ago)
        stamp = when.isoformat(timespec="seconds")
        secs = (minutes if minutes is not None else meters / 100.0) * 60.0
        return self.db.insert(
            "INSERT INTO sessions (user_id, journey_id, source, state, start_utc, end_utc, "
            "distance_m, elapsed_s, moving_s, updated_utc) VALUES (?,?,?,'ended',?,?,?,?,?,?)",
            (user_id, journey, source, stamp, stamp, meters, secs, secs, stamp))


@pytest.fixture()
def env(tmp_path, content_dir, clock):
    cfg = make_config(tmp_path, content_dir)
    db = Database(cfg.db_path)
    svc = WalkhomeService(
        cfg, db, ContentLibrary(content_dir), Hub(), source=NullTelemetrySource(),
        clock=clock, rng=random.Random(1234), push_runner=lambda fn, *a: fn(*a))
    svc.outbox = []
    yield Env(svc, cfg, db, clock)
    db.close()


@pytest.fixture()
def make_client(tmp_path, content_dir):
    """Factory for TestClients over a fresh app (sim telemetry)."""
    clients = []

    def factory(**overrides):
        cfg = make_config(tmp_path, content_dir, name=f"api{len(clients)}.db")
        cfg.ble_mode = "sim"
        cfg.checkpoint_every_s = 0.5
        cfg.tick_every_s = 0.2
        cfg.stats_cache_ttl_s = 0.0
        for k, v in overrides.items():
            setattr(cfg, k, v)
        client = TestClient(create_app(cfg))
        client.__enter__()
        clients.append(client)
        client.cfg = cfg
        return client

    yield factory
    for c in clients:
        c.__exit__(None, None, None)


class Player:
    """A registered player of an HTTP test: profile + bearer token (one shared client)."""

    def __init__(self, me, token):
        self.me, self.token = me, token
        self.id = me["id"]
        self.h = {"Authorization": f"Bearer {token}"}


def register(client, name, journey="camino", **extra):
    r = client.post("/api/auth/register",
                    json={"username": name, "password": PASSWORD, "journey_id": journey, **extra})
    assert r.status_code == 200, r.text
    token = r.cookies.get("wh_session")
    assert token
    client.cookies.clear()  # identify players by Bearer header only
    return Player(r.json(), token)
