"""In-walk challenges: "hold this pace yourself" events.

These only ever *read* speed and incline. The app never writes to the FTMS
Control Point, so a challenge can never move the belt under someone's feet
(docs/DESIGN.md sec. 2, safety).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

# A brief dip below the target does not reset progress -- treadmills report in
# 0.1 km/h steps and people adjust the belt with a button, not a dial.
GRACE_S = 4.0
# How long the walker gets to bank the required hold before it counts as
# failed, as a multiple of the hold itself.
WINDOW_FACTOR = 3.0
WINDOW_FLOOR_S = 120.0


class ChallengeState(str, Enum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass
class ActiveChallenge:
    """A challenge in flight during a live session."""

    event_id: str
    title: str
    icon: str
    kind: str  # "speed_hold" | "incline_hold"
    duration_s: float
    min_speed_kmh: float | None = None
    min_incline_pct: float | None = None
    success_text: str = ""
    failure_text: str = ""
    note: str = ""

    started_at: float = 0.0
    deadline: float = 0.0
    held_s: float = 0.0
    best_held_s: float = 0.0
    below_since: float | None = None
    state: ChallengeState = ChallengeState.RUNNING
    _fallback_used: bool = field(default=False, repr=False)

    @classmethod
    def from_event(
        cls, event: dict, now: float, *, incline_supported: bool = True
    ) -> "ActiveChallenge | None":
        spec = event.get("challenge")
        if not spec:
            return None
        used_fallback = False
        if spec.get("type") == "incline_hold" and not incline_supported:
            # The treadmill does not report incline; fall back to the pace
            # variant rather than handing the walker an unwinnable challenge.
            fallback = spec.get("fallback")
            if fallback:
                spec = {**spec, **fallback}
                used_fallback = True

        duration = float(spec.get("duration_s", 120))
        window = max(duration * WINDOW_FACTOR, WINDOW_FLOOR_S)
        return cls(
            event_id=event["id"],
            title=event.get("title", "Challenge"),
            icon=event.get("icon", "⚡"),
            kind=spec.get("type", "speed_hold"),
            duration_s=duration,
            min_speed_kmh=spec.get("min_speed_kmh"),
            min_incline_pct=spec.get("min_incline_pct"),
            success_text=spec.get("success", "You made it."),
            failure_text=spec.get("failure", "Not this time."),
            note=spec.get("note", ""),
            started_at=now,
            deadline=now + window,
            _fallback_used=used_fallback,
        )

    # --- evaluation --------------------------------------------------------

    def _meets_target(self, speed_kmh: float, incline_pct: float | None) -> bool:
        if self.kind == "incline_hold":
            if self.min_incline_pct is not None:
                if incline_pct is None or incline_pct < self.min_incline_pct:
                    return False
            if self.min_speed_kmh is not None:
                return speed_kmh >= self.min_speed_kmh
            return speed_kmh > 0.05
        return speed_kmh >= (self.min_speed_kmh or 0.0)

    def update(
        self, speed_kmh: float, incline_pct: float | None, now: float, dt: float
    ) -> ChallengeState:
        """Advance the challenge by ``dt`` seconds of walking."""
        if self.state is not ChallengeState.RUNNING:
            return self.state

        if self._meets_target(speed_kmh, incline_pct):
            self.below_since = None
            self.held_s += max(0.0, dt)
            self.best_held_s = max(self.best_held_s, self.held_s)
            if self.held_s >= self.duration_s:
                self.state = ChallengeState.SUCCEEDED
                return self.state
        else:
            if self.below_since is None:
                self.below_since = now
            elif now - self.below_since > GRACE_S:
                self.held_s = 0.0

        if now >= self.deadline:
            self.state = ChallengeState.FAILED
        return self.state

    # --- reporting ---------------------------------------------------------

    @property
    def progress(self) -> float:
        if self.duration_s <= 0:
            return 1.0
        return max(0.0, min(1.0, self.held_s / self.duration_s))

    def target_text(self) -> str:
        if self.kind == "incline_hold" and self.min_incline_pct is not None:
            return f"Hold ≥{self.min_incline_pct:g}% incline for {self._mmss()}"
        speed = self.min_speed_kmh or 0
        return f"Hold ≥{speed:g} km/h for {self._mmss()}"

    def _mmss(self) -> str:
        total = int(self.duration_s)
        return f"{total // 60}:{total % 60:02d}" if total >= 60 else f"{total}s"

    def snapshot(self, now: float) -> dict:
        return {
            "event_id": self.event_id,
            "title": self.title,
            "icon": self.icon,
            "kind": self.kind,
            "state": self.state.value,
            "target": self.target_text(),
            "note": self.note,
            "fallback_used": self._fallback_used,
            "duration_s": self.duration_s,
            "held_s": round(self.held_s, 1),
            "progress": round(self.progress, 3),
            "remaining_s": max(0.0, round(self.deadline - now, 1)),
            "min_speed_kmh": self.min_speed_kmh,
            "min_incline_pct": self.min_incline_pct,
        }

    def result_text(self) -> str:
        return (
            self.success_text
            if self.state is ChallengeState.SUCCEEDED
            else self.failure_text
        )
