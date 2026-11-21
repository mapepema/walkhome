import json
import subprocess
import sys
from pathlib import Path

import pytest

from app.content import ContentLibrary, Journey

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def library():
    content = ROOT / "content"
    if not (content / "camino.json").exists():
        subprocess.run(
            [sys.executable, str(ROOT / "tools" / "build_content.py")], check=True
        )
    return ContentLibrary(content)


def test_default_pack_loads(library):
    assert "camino" in library.journeys


def test_pack_totals(library):
    for journey in library.journeys.values():
        assert journey.total_m == 780_000  # Saint-Jean-Pied-de-Port to Santiago
        assert journey.data["total_mi"] == pytest.approx(780 / 1.609344, abs=1e-3)


def test_no_unresolved_tokens(library):
    for journey in library.journeys.values():
        blob = json.dumps(journey.data)
        assert "{home}" not in blob
        assert "{haven}" not in blob


def test_event_ids_unique_and_ordered(library):
    j = library.journeys["camino"]
    ids = [e["id"] for e in j.events]
    assert len(ids) == len(set(ids))
    marks = [e["at_m"] for e in j.events]
    assert marks == sorted(marks)


def test_pack_language(library):
    assert library.journeys["camino"].data["lang"] == "en"


def test_events_between_half_open(library):
    j = library.journeys["camino"]
    first = j.events[0]
    assert first["at_m"] == 0.0
    # an event at exactly from_m does not re-fire
    assert first not in j.events_between(0.0, 100.0)
    assert first in j.events_between(-1.0, 0.0)


def test_events_between_ordering(library):
    j = library.journeys["camino"]
    crossed = j.events_between(0.0, 60_000.0)
    marks = [e["at_m"] for e in crossed]
    assert marks == sorted(marks)
    assert all(0.0 < m <= 60_000.0 for m in marks)


def test_biome_lookup_covers_whole_journey(library):
    j = library.journeys["camino"]
    for d in (0, 1, 50_000, 1_000_000, 2_000_000, j.total_m - 1, j.total_m, j.total_m + 500):
        assert j.biome_at(d) is not None


def test_biomes_contiguous(library):
    j = library.journeys["camino"]
    for prev, cur in zip(j.biomes, j.biomes[1:]):
        assert prev["end_m"] == pytest.approx(cur["start_m"])


def test_stage_and_next_event(library):
    j = library.journeys["camino"]
    assert j.stage_at(0)["id"] == "stage1"
    assert j.stage_at(j.total_m - 1)["id"] == "stage4"
    nxt = j.next_event(0.0, kind="milestone")
    assert nxt is not None and nxt["at_m"] > 0


def test_challenges_have_specs(library):
    j = library.journeys["camino"]
    challenges = [e for e in j.events if e["kind"] == "challenge"]
    assert len(challenges) >= 5
    for c in challenges:
        spec = c["challenge"]
        assert spec["type"] in ("speed_hold", "incline_hold")
        assert spec["duration_s"] > 0
        if spec["type"] == "incline_hold":
            assert "fallback" in spec, f"{c['id']} has no fallback for no-incline treadmills"
