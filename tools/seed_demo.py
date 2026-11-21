#!/usr/bin/env python3
"""Seed a development database with a living leaderboard.

Creates six fictional players (password ``demo-password``) with walks spread
over the last three weeks, rewards paid by the real reward engine, and some of
their packs opened (when a card catalog exists for the theme).

    .venv/bin/python tools/seed_demo.py                 # data/walkhome.db
    .venv/bin/python tools/seed_demo.py --db /tmp/demo.db --reset
    WALKHOME_DB=/tmp/demo.db .venv/bin/python -m app    # then run against it

Options
    --db PATH   database to seed (default: $WALKHOME_DB or data/walkhome.db)
    --reset     delete the demo players first (and re-create them)
    --force     allow seeding a database that already holds real accounts

Safety: demo accounts are never admins, so on a fresh database the first *real*
registration still becomes the admin. Do not run this on a production Pi
(use --force only if you know why).
"""

from __future__ import annotations

import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.ble import NullTelemetrySource  # noqa: E402
from app.config import Config  # noqa: E402
from app.content import ContentLibrary  # noqa: E402
from app.db import Database  # noqa: E402
from app.hub import Hub  # noqa: E402
from app.service import WalkhomeService  # noqa: E402

PASSWORD = "demo-password"

# username, avatar, colour, theme, walker profile: (days walked of 21, km range)
PLAYERS = [
    ("ada", "🦊", "#e76f51", "camino", (17, (2.0, 6.5))),
    ("ben", "🐻", "#2a9d8f", "camino", (14, (3.0, 8.0))),
    ("cleo", "🦉", "#8d6bd0", "camino", (20, (1.5, 4.5))),
    ("dev", "🐺", "#4361ee", "camino", (9, (4.0, 9.0))),
    ("eve", "🐢", "#f4a261", "camino", (12, (2.0, 5.0))),
    ("finn", "🦅", "#e63946", "camino", (15, (2.5, 7.0))),
]


def seed(db_path: Path, reset: bool, force: bool, rng_seed: int = 42) -> None:
    cfg = Config()
    cfg.db_path = db_path
    cfg.ble_mode = "off"
    db = Database(db_path)
    svc = WalkhomeService(cfg, db, ContentLibrary(cfg.content_dir), Hub(),
                          source=NullTelemetrySource())
    demo_names = {p[0] for p in PLAYERS}
    others = [u for u in svc.list_users(include_archived=True)
              if u["username"] not in demo_names]
    if others and not force:
        sys.exit(f"refusing: {len(others)} real account(s) in {db_path}; use --force")

    rng = random.Random(rng_seed)
    now = datetime.now(timezone.utc)
    for username, avatar, color, theme, (days_walked, km) in PLAYERS:
        existing = svc.auth.user_by_username(username)
        if existing and reset:
            svc.delete_user(existing["id"])
            existing = None
        if existing:
            print(f"= {username}: already there (use --reset to rebuild)")
            continue
        user = svc.register(username=username, password=PASSWORD, journey_id=theme,
                            avatar=avatar, color=color)
        db.execute("UPDATE users SET is_admin=0 WHERE id=?", (user["id"],))  # never admin
        uid = user["id"]
        walked_days = sorted(rng.sample(range(0, 21), days_walked), reverse=True)
        for ago in walked_days:
            meters = rng.uniform(*km) * 1000
            speed = rng.uniform(3.8, 6.2)                    # km/h
            secs = meters / (speed / 3.6)
            hour = rng.choice([7, 8, 12, 18, 19, 20])
            start = (now - timedelta(days=ago)).replace(hour=hour, minute=rng.randint(0, 59),
                                                        second=0, microsecond=0)
            if start > now:
                start -= timedelta(days=1)
            stamp = start.isoformat(timespec="seconds")
            end = (start + timedelta(seconds=secs)).isoformat(timespec="seconds")
            db.insert(
                "INSERT INTO sessions (user_id, journey_id, source, state, start_utc, end_utc, "
                "distance_m, elapsed_s, moving_s, max_speed_kmh, updated_utc) "
                "VALUES (?,?,'treadmill','ended',?,?,?,?,?,?,?)",
                (uid, theme, stamp, end, meters, secs, secs, speed + 0.8, end))
        total = svc.user_progress_m(uid, theme)
        svc._invalidate(uid)
        svc._sync_after_change(uid, theme, total)        # journal + milestone events
        paid = svc.rewards.evaluate(uid)
        opened = 0
        if svc.store.get(theme):
            for grant in svc.rewards.unopened(uid):
                if rng.random() < 0.65:
                    svc.rewards.open_pack(uid, grant["id"])
                    opened += 1
        print(f"+ {username:<8} {theme:<9} {total / 1000:6.1f} km  packs +{len(paid)}"
              f" (opened {opened})")
    svc.board.settle_weekly_podium()
    db.close()
    print(f"\nDone. Log in as any of {', '.join(sorted(demo_names))} / {PASSWORD!r}.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--db", default=os.environ.get("WALKHOME_DB", str(ROOT / "data" / "walkhome.db")))
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    seed(Path(args.db), args.reset, args.force)


if __name__ == "__main__":
    main()
