"""SQLite storage.

WAL mode so the live telemetry writer never blocks the API readers, and so a
power cut costs at most the last few seconds of a walk.

Design rule from the research doc: cumulative journey progress is always
*derived* (sum of sessions + adjustments), never a lone mutable counter. That
is what makes "actually, this walk was Sam's" a one-row update.
"""

from __future__ import annotations

import contextlib
import re
import sqlite3
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = 2

# The original (v1) schema, kept verbatim: fresh databases are created at v1 and
# then migrated, so there is exactly one upgrade path and tests can build a real
# v1 database to migrate.
SCHEMA_V1 = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT    NOT NULL UNIQUE,
    avatar       TEXT    NOT NULL DEFAULT '🧝',
    color        TEXT    NOT NULL DEFAULT '#8ecae6',
    handicap     REAL    NOT NULL DEFAULT 1.0,
    daily_goal_m REAL    NOT NULL DEFAULT 3000,
    journey_id   TEXT,
    archived     INTEGER NOT NULL DEFAULT 0,
    created_utc  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    journey_id  TEXT    NOT NULL,
    created_utc TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS party_members (
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    PRIMARY KEY (party_id, user_id)
);

-- A walk. user_id is deliberately mutable: misattribution is the main risk of
-- a shared-screen family app, so reassignment must be a single UPDATE.
CREATE TABLE IF NOT EXISTS sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    journey_id        TEXT    NOT NULL,
    source            TEXT    NOT NULL DEFAULT 'treadmill',
    state             TEXT    NOT NULL DEFAULT 'active',
    start_utc         TEXT    NOT NULL,
    end_utc           TEXT,
    distance_m        REAL    NOT NULL DEFAULT 0,
    device_distance_m REAL,
    elapsed_s         REAL    NOT NULL DEFAULT 0,
    moving_s          REAL    NOT NULL DEFAULT 0,
    max_speed_kmh     REAL    NOT NULL DEFAULT 0,
    avg_hr_bpm        REAL,
    note              TEXT,
    updated_utc       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_open  ON sessions(end_utc);
CREATE INDEX IF NOT EXISTS idx_sessions_start ON sessions(start_utc);

-- Manual corrections and outdoor walks. Slots into the derived total cleanly.
CREATE TABLE IF NOT EXISTS adjustments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    journey_id  TEXT    NOT NULL,
    delta_m     REAL    NOT NULL,
    reason      TEXT,
    created_utc TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_adjustments_user ON adjustments(user_id);

-- One row per (subject, event) so a milestone can never fire twice, even
-- across a reboot mid-stride.
CREATE TABLE IF NOT EXISTS fired_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id   TEXT    NOT NULL,
    subject_kind TEXT    NOT NULL,
    subject_id   INTEGER NOT NULL,
    event_id     TEXT    NOT NULL,
    session_id   INTEGER,
    at_m         REAL    NOT NULL,
    fired_utc    TEXT    NOT NULL,
    UNIQUE (journey_id, subject_kind, subject_id, event_id)
);

CREATE TABLE IF NOT EXISTS journal (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    journey_id   TEXT    NOT NULL,
    subject_kind TEXT    NOT NULL,
    subject_id   INTEGER NOT NULL,
    kind         TEXT    NOT NULL DEFAULT 'milestone',
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL DEFAULT '',
    at_m         REAL    NOT NULL DEFAULT 0,
    icon         TEXT,
    created_utc  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_subject
    ON journal(subject_kind, subject_id, created_utc);

-- Outcome of an in-walk challenge ("hold 6 km/h for 3 minutes").
CREATE TABLE IF NOT EXISTS challenge_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER REFERENCES sessions(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    event_id     TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    succeeded    INTEGER NOT NULL,
    detail       TEXT,
    created_utc  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


SCHEMA_V2_TABLES = """
CREATE TABLE IF NOT EXISTS auth_tokens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    TEXT    NOT NULL UNIQUE,
    created_utc   TEXT    NOT NULL,
    last_used_utc TEXT    NOT NULL,
    expires_utc   TEXT    NOT NULL,
    user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);

-- One row per reward ever granted. UNIQUE(user, source, key) is what makes every
-- grant idempotent: re-running the reward engine can never pay twice.
CREATE TABLE IF NOT EXISTS pack_grants (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme       TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    source_key  TEXT    NOT NULL,
    title       TEXT    NOT NULL DEFAULT '',
    created_utc TEXT    NOT NULL,
    opened_utc  TEXT,
    UNIQUE (user_id, source, source_key)
);
CREATE INDEX IF NOT EXISTS idx_pack_grants_user ON pack_grants(user_id, opened_utc);

CREATE TABLE IF NOT EXISTS collection (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id   TEXT    NOT NULL,
    theme     TEXT    NOT NULL,
    count     INTEGER NOT NULL DEFAULT 1,
    first_utc TEXT    NOT NULL,
    PRIMARY KEY (user_id, card_id)
);

CREATE TABLE IF NOT EXISTS wallet (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    essence INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pity (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme       TEXT    NOT NULL,
    since_rare  INTEGER NOT NULL DEFAULT 0,
    since_ultra INTEGER NOT NULL DEFAULT 0,
    opened      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, theme)
);

CREATE TABLE IF NOT EXISTS quest_claims (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_id    TEXT    NOT NULL,
    period_key  TEXT    NOT NULL,
    claimed_utc TEXT    NOT NULL,
    PRIMARY KEY (user_id, quest_id, period_key)
);

CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    body        TEXT    NOT NULL DEFAULT '',
    icon        TEXT    NOT NULL DEFAULT '',
    data_json   TEXT,
    created_utc TEXT    NOT NULL,
    read_utc    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT    NOT NULL UNIQUE,
    p256dh      TEXT    NOT NULL,
    auth        TEXT    NOT NULL,
    created_utc TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS push_quota (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day     TEXT    NOT NULL,
    sent    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

-- Last evaluated standings, used to detect overtakes between two evaluations.
CREATE TABLE IF NOT EXISTS rank_snapshots (
    journey_id  TEXT    NOT NULL,
    period_key  TEXT    NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank        INTEGER NOT NULL,
    distance_m  REAL    NOT NULL,
    updated_utc TEXT    NOT NULL,
    PRIMARY KEY (journey_id, period_key, user_id)
);

CREATE TABLE IF NOT EXISTS weekly_awards (
    week_key    TEXT    NOT NULL,
    journey_id  TEXT    NOT NULL,
    place       INTEGER NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    distance_m  REAL    NOT NULL,
    packs       INTEGER NOT NULL,
    created_utc TEXT    NOT NULL,
    PRIMARY KEY (week_key, journey_id, place)
);
"""

SCHEMA_V2_INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sessions_user_journey ON sessions(user_id, journey_id, start_utc);
"""


def slugify(text: str, fallback: str = "walker") -> str:
    """Username-safe slug: ASCII, ``[a-z0-9_.-]``, 3-24 chars."""
    norm = unicodedata.normalize("NFKD", text or "")
    ascii_text = norm.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9_.-]+", "-", ascii_text).strip("-._")[:24]
    return slug if len(slug) >= 3 else fallback


_clock_override = None


def set_clock(fn=None) -> None:
    """Tests only: make every stored timestamp come from a fake clock."""
    global _clock_override
    _clock_override = fn


def utcnow() -> str:
    """Timestamps are stored in UTC ISO-8601; the UI renders local time."""
    now = _clock_override() if _clock_override else datetime.now(timezone.utc)
    return now.astimezone(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Thin synchronous SQLite wrapper.

    Every statement runs under one lock, which keeps the telemetry loop and the
    request handlers from interleaving mid-transaction. All the work here is
    sub-millisecond, so a lock is cheaper than a connection pool on a Pi.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._tx_depth = 0
        self._conn = sqlite3.connect(
            str(self.path), check_same_thread=False, isolation_level=None
        )
        self._conn.row_factory = sqlite3.Row
        self._configure()
        self._migrate()

    def _configure(self) -> None:
        cur = self._conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    def _migrate(self) -> None:
        """Bring the database to SCHEMA_VERSION without ever dropping user data."""
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            row = self._conn.execute(
                "SELECT value FROM meta WHERE key='schema_version'"
            ).fetchone()
            if row is None:
                has_users = self._conn.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
                ).fetchone()
                version = 1 if has_users else 0
            else:
                version = int(row["value"])
            if version < 1:
                self._conn.executescript(SCHEMA_V1)
                self._set_version(1)
                version = 1
            if version < 2:
                self._migrate_v1_to_v2()
                version = 2
            if version < SCHEMA_VERSION:  # pragma: no cover - future steps
                raise RuntimeError(f"no migration path from schema v{version}")
            self._conn.executescript(SCHEMA_V2_INDEXES)

    def _set_version(self, version: int) -> None:
        self._conn.execute(
            "INSERT INTO meta(key, value) VALUES('schema_version', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(version),),
        )

    def _migrate_v1_to_v2(self) -> None:
        """v1 -> v2: accounts, rewards, social. Non destructive.

        Existing walkers become claimable accounts (``password_hash`` NULL);
        the party tables are dropped (the leaderboard replaces them) together
        with the party rows of the derived tables.
        """
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            have = {r["name"] for r in self._conn.execute("PRAGMA table_info(users)")}
            for col, ddl in (
                ("username", "TEXT"),
                ("password_hash", "TEXT"),
                ("is_admin", "INTEGER NOT NULL DEFAULT 0"),
                ("units", "TEXT NOT NULL DEFAULT 'km'"),
                ("last_seen_utc", "TEXT"),
            ):
                if col not in have:
                    self._conn.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
            taken: set = set()
            rows = self._conn.execute(
                "SELECT id, display_name, username FROM users ORDER BY id"
            ).fetchall()
            for r in rows:
                if r["username"]:
                    taken.add(r["username"].lower())
            for r in rows:
                if r["username"]:
                    continue
                name = slugify(r["display_name"], fallback=f"walker{r['id']}")
                candidate, n = name, 2
                while candidate.lower() in taken:
                    candidate = f"{name[:20]}-{n}"
                    n += 1
                taken.add(candidate.lower())
                self._conn.execute(
                    "UPDATE users SET username=? WHERE id=?", (candidate, r["id"])
                )
        except Exception:
            self._conn.execute("ROLLBACK")
            raise
        # executescript() commits implicitly, so finish the transaction first.
        self._conn.execute("COMMIT")
        self._conn.executescript(SCHEMA_V2_TABLES)
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            self._conn.execute("DELETE FROM fired_events WHERE subject_kind='party'")
            self._conn.execute("DELETE FROM journal WHERE subject_kind='party'")
            self._conn.execute("DROP TABLE IF EXISTS party_members")
            self._conn.execute("DROP TABLE IF EXISTS parties")
            self._set_version(2)
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    @contextlib.contextmanager
    def transaction(self):
        """Atomic multi-statement section (re-entrant; the outermost one commits)."""
        with self._lock:
            if self._tx_depth > 0:
                self._tx_depth += 1
                try:
                    yield self
                finally:
                    self._tx_depth -= 1
                return
            self._conn.execute("BEGIN IMMEDIATE")
            self._tx_depth = 1
            try:
                yield self
            except BaseException:
                self._tx_depth = 0
                self._conn.execute("ROLLBACK")
                raise
            else:
                self._tx_depth = 0
                self._conn.execute("COMMIT")

    # --- low-level helpers -------------------------------------------------

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def insert(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            return int(cur.lastrowid or 0)

    def backup_to(self, dest: Path | str) -> Path:
        """Consistent online copy of the DB (safe while a walk is running)."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            target = sqlite3.connect(str(dest))
            try:
                self._conn.backup(target)
            finally:
                target.close()
        return dest

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- settings ----------------------------------------------------------

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = self.query_one("SELECT value FROM settings WHERE key=?", (key,))
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]
