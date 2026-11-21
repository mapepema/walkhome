"""The distance-accounting guarantees, exercised without hardware or sleep().

Every scenario from docs/DESIGN.md sec. 3 lives here: steady walking, real
pauses vs dropouts, console resets, gap recovery via the cumulative field, and
resuming after a reboot.
"""

import pytest

from app.ftms import TreadmillSample
from app.tracker import (
    KMH_TO_MS,
    DistanceTracker,
    LinkMonitor,
    LinkState,
    WalkState,
)


def sample(speed=5.0, total=None, hr=None):
    return TreadmillSample(
        speed_kmh=speed, total_distance_m=total, heart_rate_bpm=hr
    )


class TestIntegration:
    def test_steady_walk_integrates_correctly(self):
        t = DistanceTracker()
        # 6 km/h for 60 seconds = 100 m
        for i in range(61):
            t.on_sample(sample(speed=6.0), now=float(i))
        assert t.distance_m == pytest.approx(100.0, rel=0.01)
        assert t.elapsed_s == pytest.approx(60.0)
        assert t.moving_s == pytest.approx(60.0)

    def test_trapezoidal_on_speed_change(self):
        t = DistanceTracker()
        t.on_sample(sample(speed=0.0), now=0.0)
        t.on_sample(sample(speed=10.0), now=1.0)
        # average of 0 and 10 km/h over 1 s
        assert t.distance_m == pytest.approx(5.0 * KMH_TO_MS)

    def test_zero_speed_credits_nothing(self):
        t = DistanceTracker()
        for i in range(10):
            t.on_sample(sample(speed=0.0), now=float(i))
        assert t.distance_m == 0.0
        assert t.moving_s == 0.0
        assert t.elapsed_s == pytest.approx(9.0)

    def test_backwards_clock_is_ignored(self):
        t = DistanceTracker()
        t.on_sample(sample(), now=100.0)
        t.on_sample(sample(), now=90.0)  # clock stepped back
        assert t.distance_m == 0.0
        t.on_sample(sample(speed=6.0), now=91.0)
        assert t.distance_m > 0

    def test_missing_speed_field_reuses_last(self):
        t = DistanceTracker()
        t.on_sample(sample(speed=6.0), now=0.0)
        t.on_sample(TreadmillSample(speed_kmh=None, heart_rate_bpm=120), now=1.0)
        assert t.distance_m == pytest.approx(6.0 * KMH_TO_MS)


class TestGapsAndDropouts:
    def test_gap_not_credited_by_integration(self):
        t = DistanceTracker(max_gap_s=3.0)
        t.on_sample(sample(speed=6.0), now=0.0)
        t.on_sample(sample(speed=6.0), now=1.0)
        # 30-second dropout
        t.on_sample(sample(speed=6.0), now=31.0)
        assert t.distance_m == pytest.approx(6.0 * KMH_TO_MS, rel=0.01)
        assert t.gaps_seen == 1
        assert t.uncredited_gap_s == pytest.approx(30.0)

    def test_gap_recovered_via_device_total(self):
        """The belt kept moving during a dropout; the cumulative field has the
        truth and reconciliation must recover every metre."""
        t = DistanceTracker(max_gap_s=3.0, reconcile_every_s=60.0)
        # 10 s of walking at 6 km/h with the device total tracking along
        for i in range(11):
            t.on_sample(sample(speed=6.0, total=int(i * 6 * KMH_TO_MS)), now=float(i))
        # 60 s dropout during which the walker covered 100 m
        t.on_sample(sample(speed=6.0, total=int(10 * 6 * KMH_TO_MS) + 100), now=70.0)
        report = t.reconcile(now=70.0)
        assert report is not None and report.accepted
        # ~16.7 m integrated + 100 m recovered
        assert t.distance_m == pytest.approx(10 * 6 * KMH_TO_MS + 100, abs=2.0)
        assert t.uncredited_gap_s == 0.0

    def test_reconcile_rejects_garbage_device_value(self):
        t = DistanceTracker(reconcile_min_abs_m=50.0, reconcile_max_drift_ratio=0.10)
        t.on_sample(sample(speed=6.0, total=0), now=0.0)
        for i in range(1, 61):
            t.on_sample(sample(speed=6.0, total=i * 2), now=float(i))
        # device claims 5 km more than integration with no gap to explain it
        t.on_sample(sample(speed=6.0, total=5000), now=61.0)
        report = t.reconcile(now=61.0)
        assert report is not None and not report.accepted
        assert t.distance_m < 300


class TestConsoleReset:
    def test_reset_never_subtracts(self):
        t = DistanceTracker()
        t.on_sample(sample(speed=6.0, total=500), now=0.0)
        t.on_sample(sample(speed=6.0, total=510), now=1.0)
        assert t.device_m == pytest.approx(10.0)
        # console power-cycles: field jumps to 0
        t.on_sample(sample(speed=6.0, total=0), now=2.0)
        assert t.device_m == pytest.approx(10.0)
        assert t.resets_seen == 1
        # and resumes accumulating from the new baseline
        t.on_sample(sample(speed=6.0, total=5), now=3.0)
        assert t.device_m == pytest.approx(15.0)

    def test_integer_jitter_is_not_a_reset(self):
        t = DistanceTracker()
        t.on_sample(sample(total=100), now=0.0)
        t.on_sample(sample(total=100), now=1.0)
        t.on_sample(sample(total=101), now=2.0)
        assert t.resets_seen == 0
        assert t.device_m == pytest.approx(1.0)


class TestResume:
    def test_resumed_tracker_starts_from_checkpoint(self):
        t = DistanceTracker.resumed(distance_m=4321.0, elapsed_s=3000.0)
        assert t.distance_m == 4321.0
        t.on_sample(sample(speed=6.0), now=0.0)
        t.on_sample(sample(speed=6.0), now=1.0)
        assert t.distance_m == pytest.approx(4321.0 + 6.0 * KMH_TO_MS)

    def test_resumed_tracker_reconciles_sanely(self):
        """After a reboot the device total starts fresh; the first observed
        value becomes the baseline and must not drag distance to zero."""
        t = DistanceTracker.resumed(distance_m=4321.0)
        t.on_sample(sample(speed=6.0, total=0), now=0.0)
        for i in range(1, 61):
            t.on_sample(sample(speed=6.0, total=int(i * 6 * KMH_TO_MS)), now=float(i))
        report = t.reconcile(now=61.0)
        assert report is not None and report.accepted
        assert t.distance_m == pytest.approx(4321.0 + 60 * 6 * KMH_TO_MS, abs=5.0)


class TestLinkMonitor:
    def test_pause_vs_dropout_are_distinct(self):
        m = LinkMonitor(link_timeout_s=5.0, autopause_after_s=8.0)
        m.on_connected(0.0)
        m.on_sample(5.0, 0.0)
        assert m.walk_state(1.0) is WalkState.ACTIVE

        # speed drops to zero with a live link -> pause, after the delay
        m.on_sample(0.0, 2.0)
        assert m.walk_state(3.0) is WalkState.ACTIVE  # not yet
        m.on_sample(0.0, 9.0)
        assert m.walk_state(10.5) is WalkState.PAUSED

        # notifications stop entirely -> NO_LINK, not paused
        assert m.walk_state(20.0) is WalkState.NO_LINK
        assert m.link_state(20.0) is LinkState.STALE

    def test_disconnect_is_no_link(self):
        m = LinkMonitor()
        m.on_connected(0.0)
        m.on_sample(5.0, 0.0)
        m.on_disconnected()
        assert m.link_state(1.0) is LinkState.DISCONNECTED
        assert m.walk_state(1.0) is WalkState.NO_LINK

    def test_resume_from_pause(self):
        m = LinkMonitor(autopause_after_s=8.0)
        m.on_connected(0.0)
        # zero-speed samples keep arriving (live link, stopped belt)
        for i in range(11):
            m.on_sample(0.0, float(i))
        assert m.walk_state(10.5) is WalkState.PAUSED
        m.on_sample(4.0, 11.0)
        assert m.walk_state(11.5) is WalkState.ACTIVE
