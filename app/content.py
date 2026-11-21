"""Loading and querying journey content packs.

A pack is pure data (see ``tools/build_content.py``). Nothing about the theme
is hard-coded anywhere else in the app, so swapping packs swaps the whole
world: names, prose, biomes, palettes, map.
"""

from __future__ import annotations

import bisect
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

MI_TO_M = 1609.344


@dataclass
class Journey:
    """One loaded content pack, indexed for fast lookups by distance."""

    data: dict[str, Any]

    def __post_init__(self) -> None:
        self.id: str = self.data["id"]
        self.name: str = self.data["name"]
        self.total_m: float = float(self.data["total_m"])
        self.events: list[dict] = sorted(
            self.data.get("events", []), key=lambda e: e["at_m"]
        )
        self._event_marks: list[float] = [e["at_m"] for e in self.events]
        self.biomes: list[dict] = sorted(
            self.data.get("biomes", []), key=lambda b: b["start_m"]
        )
        self._biome_starts: list[float] = [b["start_m"] for b in self.biomes]
        self.stages: list[dict] = sorted(
            self.data.get("stages", []), key=lambda s: s["start_m"]
        )
        self._by_id: dict[str, dict] = {e["id"]: e for e in self.events}

    # --- lookups -----------------------------------------------------------

    def event(self, event_id: str) -> dict | None:
        return self._by_id.get(event_id)

    def events_between(self, from_m: float, to_m: float) -> list[dict]:
        """Events in ``(from_m, to_m]`` -- exactly what a step forward crosses.

        Half-open on the left so an event never fires twice when progress
        stalls exactly on a milepost.
        """
        if to_m <= from_m:
            return []
        lo = bisect.bisect_right(self._event_marks, from_m)
        hi = bisect.bisect_right(self._event_marks, to_m)
        return self.events[lo:hi]

    def biome_at(self, distance_m: float) -> dict | None:
        if not self.biomes:
            return None
        d = max(0.0, min(distance_m, self.total_m - 1e-6))
        idx = bisect.bisect_right(self._biome_starts, d) - 1
        return self.biomes[max(0, idx)]

    def stage_at(self, distance_m: float) -> dict | None:
        for stage in self.stages:
            if stage["start_m"] <= distance_m < stage["end_m"]:
                return stage
        return self.stages[-1] if self.stages else None

    def next_event(self, distance_m: float, kind: str | None = None) -> dict | None:
        idx = bisect.bisect_right(self._event_marks, distance_m)
        for event in self.events[idx:]:
            if kind is None or event.get("kind") == kind:
                return event
        return None

    def last_event(self, distance_m: float) -> dict | None:
        idx = bisect.bisect_right(self._event_marks, distance_m) - 1
        return self.events[idx] if idx >= 0 else None

    def progress_fraction(self, distance_m: float) -> float:
        if self.total_m <= 0:
            return 0.0
        return max(0.0, min(1.0, distance_m / self.total_m))

    def summary(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "subtitle": self.data.get("subtitle", ""),
            "total_m": self.total_m,
            "total_mi": self.data.get("total_mi"),
            "source_note": self.data.get("source_note", ""),
            "stage_count": len(self.stages),
            "biome_count": len(self.biomes),
            "event_count": len(self.events),
        }


class ContentLibrary:
    """All packs found in the content directory."""

    def __init__(self, content_dir: Path | str) -> None:
        self.dir = Path(content_dir)
        self.journeys: dict[str, Journey] = {}
        self.reload()

    def reload(self) -> None:
        found: dict[str, Journey] = {}
        for path in sorted(self.dir.glob("*.json")):
            try:
                data = json.loads(path.read_text())
            except json.JSONDecodeError as exc:
                raise ValueError(f"content pack {path.name} is not valid JSON: {exc}")
            if "id" not in data or "events" not in data:
                continue
            found[data["id"]] = Journey(data)
        self.journeys = found

    def get(self, journey_id: str) -> Journey | None:
        return self.journeys.get(journey_id)

    def require(self, journey_id: str) -> Journey:
        journey = self.get(journey_id)
        if journey is None:
            known = ", ".join(sorted(self.journeys)) or "none"
            raise KeyError(f"unknown journey {journey_id!r} (available: {known})")
        return journey

    def default_id(self, preferred: str | None = None) -> str:
        if preferred and preferred in self.journeys:
            return preferred
        if not self.journeys:
            raise RuntimeError(f"no content packs found in {self.dir}")
        return sorted(self.journeys)[0]

    def list_summaries(self) -> list[dict]:
        return [j.summary() for j in self.journeys.values()]
