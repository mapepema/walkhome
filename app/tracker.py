"""Distance accounting and the live session state machine.

Two rules from docs/DESIGN.md sec. 3 drive everything here:

1. Integrated instantaneous speed is the *primary* distance source. It is
   immune to console resets and gives sub-second values for the parallax.
2. The treadmill's own cumulative Total Distance field is a *cross-check*.
   It is accumulated as positive deltas only, so a console reset (the field
   dropping to zero) can never subtract distance -- and it is what recovers
   the metres walked during a BLE dropout.

Everything in this module is pure and takes ``now`` as an argument, so the
awkward cases -- dropouts, resets, midnight, a Pi reboot mid-stride -- are all
reachable from a unit test without hardware or sleeping.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum

from .ftms import TreadmillSample

log = logging.getLogger(__name__)

KMH_TO_MS = 1000.0 / 3600.0
# No human on a treadmill exceeds this; used to bound gap-recovery credit.
PLAUSIBLE_MAX_MS = 25.0 * KMH_TO_MS
# The cumulative field is integer metres, so tolerate 1 m of jitter before
# calling something a reset.
RESET_TOLERANCE_M = 1.0


class LinkState(str, Enum):
    """Is telemetry flowing?"""

    DISCONNECTED = "disconnected"
    LIVE = "live"
    STALE = "stale"  # connected, but notifications stopped arriving


class WalkState(str, Enum):
    """What the walker is doing."""

    IDLE = "idle"
    ACTIVE = "active"
    PAUSED = "paused"  # speed 0 with a live link -- a real pause
    NO_LINK = "no_link"  # notifications stopped -- not a pause, a problem
    ENDED = "ended"


@dataclass
class ReconcileReport:
    accepted: bool
    delta_m: float
    budget_m: float
    device_m: float
    tracked_m: float
    reason: str = ""


@dataclass
class DistanceTracker:
    """Accumulates one session's distance from a stream of FTMS samples."""

    max_gap_s: float = 3.0
    reconcile_every_s: float = 60.0
    reconcile_max_drift_ratio: float = 0.10
    reconcile_min_abs_m: float = 50.0

    # Authoritative session distance.
    distance_m: float = 0.0
    # Speed-integration only, kept for diagnostics/drift reporting.
    integrated_m: float = 0.0
    # Device cumulative field, accumulated as positive deltas only.
    device_m: float = 0.0

    elapsed_s: float = 0.0
    moving_s: float = 0.0
    max_speed_kmh: float = 0.0
    speed_kmh: float = 0.0

    samples: int = 0
    resets_seen: int = 0
    gaps_seen: int = 0
    uncredited_gap_s: float = 0.0
    last_reconcile: ReconcileReport | None = None

    _last_ts: float | None = field(default=None, repr=False)
    _last_speed_kmh: float = field(default=0.0, repr=False)
    _last_device_total: int | None = field(default=None, repr=False)
    _device_seen: bool = field(default=False, repr=False)
    _next_reconcile_ts: float | None = field(default=None, repr=False)
    _hr_sum: float = field(default=0.0, repr=False)
    _hr_count: int = field(default=0, repr=False)

    @classmethod
    def resumed(cls, distance_m: float, elapsed_s: float = 0.0, **kwargs):
        """Rebuild a tracker for a session recovered from the database.

        Both accumulators start at the persisted distance so the first
        reconciliation compares like with like instead of snapping to zero.
        """
        t = cls(**kwargs)
        t.distance_m = distance_m
        t.integrated_m = distance_m
        t.device_m = distance_m
        t.elapsed_s = elapsed_s
        return t

    # --- ingest ------------------------------------------------------------

    def on_sample(self, sample: TreadmillSample, now: float) -> float:
        """Feed one decoded notification. Returns the distance credited (m)."""
        speed = sample.speed_kmh if sample.speed_kmh is not None else self._last_speed_kmh
        speed = max(0.0, speed)
        credited = 0.0

        if self._last_ts is not None:
            dt = now - self._last_ts
            if dt < 0:
                # Clock stepped backwards; skip this interval rather than
                # crediting a negative distance.
                log.warning("clock moved backwards by %.3fs; interval skipped", -dt)
                dt = 0.0
            if dt > self.max_gap_s:
                # A gap. Do not invent distance here -- if the treadmill
                # reports a cumulative total, reconciliation will recover the
                # real metres walked during the gap; otherwise they are lost,
                # which is the safe direction to be wrong in.
                self.gaps_seen += 1
                self.uncredited_gap_s += dt
                log.info("telemetry gap of %.1fs -- not credited by integration", dt)
            elif dt > 0:
                # Trapezoidal: average the speed across the interval.
                avg_kmh = (self._last_speed_kmh + speed) / 2.0
                credited = avg_kmh * KMH_TO_MS * dt
                self.integrated_m += credited
                self.distance_m += credited
                self.elapsed_s += dt
                if avg_kmh > 0.05:
                    self.moving_s += dt

        self._last_ts = now
        self._last_speed_kmh = speed
        self.speed_kmh = speed
        self.samples += 1
        self.max_speed_kmh = max(self.max_speed_kmh, speed)

        if sample.heart_rate_bpm:
            self._hr_sum += sample.heart_rate_bpm
            self._hr_count += 1

        self._track_device_total(sample.total_distance_m)

        if self._next_reconcile_ts is None:
            self._next_reconcile_ts = now + self.reconcile_every_s
        elif now >= self._next_reconcile_ts:
            self.reconcile(now)

        return credited

    def _track_device_total(self, total: int | None) -> None:
        if total is None:
            return
        if self._last_device_total is None:
            self._last_device_total = total
            self._device_seen = True
            return
        delta = total - self._last_device_total
        if delta < -RESET_TOLERANCE_M:
            # Console reset / power cycle: the field jumped back. Never
            # subtract -- just re-baseline and carry on.
            self.resets_seen += 1
            log.info(
                "treadmill cumulative distance reset (%d m -> %d m); re-baselining",
                self._last_device_total,
                total,
            )
        elif delta > 0:
            self.device_m += delta
        self._last_device_total = total

    # --- reconciliation ----------------------------------------------------

    def reconcile(self, now: float) -> ReconcileReport | None:
        """Correct integration drift against the treadmill's own total.

        The correction is accepted only inside a budget: normal drift, plus
        whatever distance could plausibly have been walked during telemetry
        gaps. That lets a BLE dropout be recovered in full while still
        rejecting a nonsense reading.
        """
        self._next_reconcile_ts = now + self.reconcile_every_s
        if not self._device_seen:
            return None

        delta = self.device_m - self.distance_m
        budget = (
            max(
                self.reconcile_min_abs_m,
                self.reconcile_max_drift_ratio * max(self.distance_m, 1.0),
            )
            + self.uncredited_gap_s * PLAUSIBLE_MAX_MS
        )
        if abs(delta) <= budget:
            self.distance_m = self.device_m
            self.uncredited_gap_s = 0.0
            report = ReconcileReport(True, delta, budget, self.device_m,
                                     self.distance_m)
        else:
            report = ReconcileReport(
                False, delta, budget, self.device_m, self.distance_m,
                reason="disagreement outside plausible budget; keeping "
                       "integrated distance",
            )
            log.warning(
                "distance reconciliation rejected: device=%.1fm tracked=%.1fm "
                "delta=%.1fm budget=%.1fm",
                self.device_m, self.distance_m, delta, budget,
            )
        self.last_reconcile = report
        return report

    # --- reporting ---------------------------------------------------------

    @property
    def avg_hr_bpm(self) -> float | None:
        return self._hr_sum / self._hr_count if self._hr_count else None

    @property
    def drift_m(self) -> float | None:
        return self.device_m - self.integrated_m if self._device_seen else None

    def snapshot(self) -> dict:
        return {
            "distance_m": round(self.distance_m, 2),
            "integrated_m": round(self.integrated_m, 2),
            "device_m": round(self.device_m, 2) if self._device_seen else None,
            "drift_m": round(self.drift_m, 2) if self.drift_m is not None else None,
            "elapsed_s": round(self.elapsed_s, 1),
            "moving_s": round(self.moving_s, 1),
            "speed_kmh": round(self.speed_kmh, 2),
            "max_speed_kmh": round(self.max_speed_kmh, 2),
            "avg_hr_bpm": round(self.avg_hr_bpm, 1) if self.avg_hr_bpm else None,
            "samples": self.samples,
            "resets_seen": self.resets_seen,
            "gaps_seen": self.gaps_seen,
        }


@dataclass
class LinkMonitor:
    """Turns the arrival (or absence) of notifications into a walk state.

    A real pause is a *valid sample reporting zero speed*. A dropout is the
    *absence of samples*. Conflating the two is how apps lose walks.
    """

    link_timeout_s: float = 5.0
    autopause_after_s: float = 8.0

    connected: bool = False
    last_sample_ts: float | None = None
    zero_since: float | None = None

    def on_connected(self, now: float) -> None:
        self.connected = True
        self.last_sample_ts = now

    def on_disconnected(self) -> None:
        self.connected = False
        self.last_sample_ts = None
        self.zero_since = None

    def on_sample(self, speed_kmh: float, now: float) -> None:
        self.last_sample_ts = now
        self.connected = True
        if speed_kmh <= 0.05:
            if self.zero_since is None:
                self.zero_since = now
        else:
            self.zero_since = None

    def link_state(self, now: float) -> LinkState:
        if not self.connected or self.last_sample_ts is None:
            return LinkState.DISCONNECTED
        if now - self.last_sample_ts > self.link_timeout_s:
            return LinkState.STALE
        return LinkState.LIVE

    def walk_state(self, now: float) -> WalkState:
        link = self.link_state(now)
        if link is not LinkState.LIVE:
            return WalkState.NO_LINK
        if self.zero_since is not None and now - self.zero_since >= self.autopause_after_s:
            return WalkState.PAUSED
        return WalkState.ACTIVE

    def idle_for(self, now: float) -> float:
        """Seconds since the belt last moved (0 while moving)."""
        if self.zero_since is None:
            return 0.0
        return max(0.0, now - self.zero_since)
