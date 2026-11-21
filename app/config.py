"""Runtime configuration, all overridable by environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return float(raw)


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return int(raw)


def _default_web_dir() -> Path:
    """Serve the built React frontend (frontend/dist), unless overridden.
    When the directory does not exist the API still runs, without a UI."""
    override = os.environ.get("WALKHOME_WEB")
    if override:
        return Path(override)
    dist = ROOT / "frontend" / "dist"
    return dist


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Config:
    # --- storage ---
    db_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("WALKHOME_DB", str(ROOT / "data" / "walkhome.db"))
        )
    )
    content_dir: Path = field(
        default_factory=lambda: Path(
            os.environ.get("WALKHOME_CONTENT", str(ROOT / "content"))
        )
    )
    web_dir: Path = field(default_factory=lambda: _default_web_dir())

    # --- BLE ---
    # "auto"  -> connect to a real FTMS treadmill via bleak
    # "sim"   -> run the built-in treadmill simulator (no hardware needed)
    # "off"   -> no telemetry source at all (manual entry only)
    ble_mode: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_BLE", "sim").lower()
    )
    device_address: str | None = field(
        default_factory=lambda: os.environ.get("WALKHOME_DEVICE_ADDRESS") or None
    )
    device_name_hint: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_DEVICE_NAME", "")
    )
    scan_timeout_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_SCAN_TIMEOUT", 12.0)
    )
    reconnect_min_s: float = 1.0
    reconnect_max_s: float = 30.0

    # --- telemetry / distance accounting ---
    # A gap in notifications longer than this is not credited as distance.
    max_integration_gap_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_MAX_GAP", 3.0)
    )
    # No notification for this long => we consider the link dead.
    link_timeout_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_LINK_TIMEOUT", 5.0)
    )
    # Speed == 0 for this long (with a live link) => auto-pause.
    autopause_after_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_AUTOPAUSE", 8.0)
    )
    # How often we reconcile integrated distance against the treadmill's own
    # cumulative Total Distance field.
    reconcile_every_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_RECONCILE", 60.0)
    )
    # Reconciliation is refused if the two sources disagree by more than this
    # fraction of the integrated value (protects against a garbage field).
    reconcile_max_drift_ratio: float = field(
        default_factory=lambda: _env_float("WALKHOME_RECONCILE_DRIFT", 0.10)
    )
    # ...but small absolute disagreements are always safe to accept.
    reconcile_min_abs_m: float = field(
        default_factory=lambda: _env_float("WALKHOME_RECONCILE_ABS", 50.0)
    )
    # An unattended active session is auto-closed after this long with no motion.
    stale_session_close_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_STALE_CLOSE", 30 * 60.0)
    )

    # --- persistence / broadcast cadence ---
    checkpoint_every_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_CHECKPOINT", 3.0)
    )
    tick_every_s: float = field(
        default_factory=lambda: _env_float("WALKHOME_TICK", 1.0)
    )

    # --- presentation ---
    units: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_UNITS", "km").lower()
    )
    default_pack: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_PACK", "camino")
    )

    # --- accounts / rewards ---
    # Timezone that defines "today", "this week" and the 19:00 streak reminder.
    tz_name: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_TZ", "Europe/Paris")
    )
    # "open": anyone can register. "invite": registration needs invite_code.
    registration: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_REGISTRATION", "open").lower()
    )
    invite_code: str = field(
        default_factory=lambda: os.environ.get("WALKHOME_INVITE_CODE", "")
    )
    session_days: int = field(default_factory=lambda: _env_int("WALKHOME_SESSION_DAYS", 90))
    # Force/forbid the Secure cookie flag. None = detect via x-forwarded-proto.
    cookie_secure: Optional[bool] = None
    manual_reward_cap_m: float = field(
        default_factory=lambda: _env_float("WALKHOME_MANUAL_CAP_M", 5000.0)
    )
    # Short TTL cache of derived reward distance (the 1 Hz snapshot reads it).
    stats_cache_ttl_s: float = 2.0
    login_max_failures: int = 5
    # Sign-ups per IP per hour (each one costs a scrypt hash on a small Pi).
    register_max_per_hour: int = 20
    login_window_s: float = 60.0
    # Web Push (optional). Keys default to <db dir>/vapid.json.
    vapid_path: Optional[Path] = None
    vapid_subject: str = field(
        default_factory=lambda: os.environ.get(
            "WALKHOME_VAPID_SUBJECT", "mailto:admin@walkhome.local"
        )
    )
    push_daily_quota: int = 6
    streak_risk_hour: int = 19

    # --- server ---
    host: str = field(default_factory=lambda: os.environ.get("WALKHOME_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _env_int("WALKHOME_PORT", 8090))
    dev_endpoints: bool = field(
        default_factory=lambda: _env_bool("WALKHOME_DEV", True)
    )

    def get_vapid_path(self) -> Path:
        return self.vapid_path or (self.db_path.parent / "vapid.json")

    def ensure_dirs(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)


config = Config()
