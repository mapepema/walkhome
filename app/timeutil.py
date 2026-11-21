"""Time helpers: everything is stored in UTC, but "today" and "this week" are
defined in the household's timezone (``WALKHOME_TZ``)."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Callable, Optional, Tuple

Clock = Callable[[], datetime]


def system_clock() -> datetime:
    return datetime.now(timezone.utc)


def get_tz(name: str) -> tzinfo:
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - unknown zone / no tzdata: fall back to UTC
        return timezone.utc


def parse_utc(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    """Canonical stored form (sortable as a string)."""
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def local_date(dt_utc: datetime, tz: tzinfo) -> date:
    return dt_utc.astimezone(tz).date()


def day_start_utc(day: date, tz: tzinfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


def day_bounds_utc(day: date, tz: tzinfo) -> Tuple[datetime, datetime]:
    return day_start_utc(day, tz), day_start_utc(day + timedelta(days=1), tz)


def week_key(day: date) -> str:
    iso_year, iso_week, _ = day.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def week_start_date(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_bounds_utc(day: date, tz: tzinfo) -> Tuple[datetime, datetime]:
    monday = week_start_date(day)
    return day_start_utc(monday, tz), day_start_utc(monday + timedelta(days=7), tz)


def month_bounds_utc(day: date, tz: tzinfo) -> Tuple[datetime, datetime]:
    first = day.replace(day=1)
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    return day_start_utc(first, tz), day_start_utc(nxt, tz)
