from app.challenges import GRACE_S, ActiveChallenge, ChallengeState


def make_event(kind="speed_hold", **spec):
    base = {"min_speed_kmh": 6.0, "duration_s": 60, "type": kind,
            "success": "yes", "failure": "no"}
    base.update(spec)
    return {"id": "e1", "title": "Test", "icon": "⚡", "kind": "challenge",
            "challenge": base}


def test_success_after_holding():
    c = ActiveChallenge.from_event(make_event(), now=0.0)
    now = 0.0
    for _ in range(61):
        now += 1.0
        c.update(6.5, None, now, 1.0)
    assert c.state is ChallengeState.SUCCEEDED
    assert c.result_text() == "yes"


def test_brief_dip_within_grace_keeps_progress(  ):
    c = ActiveChallenge.from_event(make_event(), now=0.0)
    now = 0.0
    for _ in range(30):
        now += 1.0
        c.update(6.5, None, now, 1.0)
    held = c.held_s
    # 2-second dip (inside GRACE_S)
    for _ in range(2):
        now += 1.0
        c.update(5.0, None, now, 1.0)
    assert c.held_s == held
    for _ in range(31):
        now += 1.0
        c.update(6.5, None, now, 1.0)
    assert c.state is ChallengeState.SUCCEEDED


def test_long_dip_resets_progress():
    c = ActiveChallenge.from_event(make_event(), now=0.0)
    now = 0.0
    for _ in range(30):
        now += 1.0
        c.update(6.5, None, now, 1.0)
    for _ in range(int(GRACE_S) + 2):
        now += 1.0
        c.update(3.0, None, now, 1.0)
    assert c.held_s == 0.0
    assert c.state is ChallengeState.RUNNING


def test_timeout_fails():
    c = ActiveChallenge.from_event(make_event(duration_s=60), now=0.0)
    now = 0.0
    while c.state is ChallengeState.RUNNING:
        now += 1.0
        c.update(1.0, None, now, 1.0)
        assert now < 10_000
    assert c.state is ChallengeState.FAILED
    assert c.result_text() == "no"


def test_incline_hold_uses_incline():
    event = make_event(kind="incline_hold", min_incline_pct=3.0, duration_s=10)
    del event["challenge"]["min_speed_kmh"]
    c = ActiveChallenge.from_event(event, now=0.0)
    now = 0.0
    for _ in range(11):
        now += 1.0
        c.update(4.0, 3.5, now, 1.0)
    assert c.state is ChallengeState.SUCCEEDED


def test_incline_fallback_when_unsupported():
    event = make_event(
        kind="incline_hold", min_incline_pct=3.0, duration_s=10,
        fallback={"type": "speed_hold", "min_speed_kmh": 5.0, "duration_s": 10},
    )
    c = ActiveChallenge.from_event(event, now=0.0, incline_supported=False)
    assert c.kind == "speed_hold"
    assert c.min_speed_kmh == 5.0
    now = 0.0
    for _ in range(11):
        now += 1.0
        c.update(5.5, None, now, 1.0)
    assert c.state is ChallengeState.SUCCEEDED


def test_snapshot_shape():
    c = ActiveChallenge.from_event(make_event(), now=0.0)
    snap = c.snapshot(now=1.0)
    for key in ("event_id", "state", "target", "progress", "remaining_s"):
        assert key in snap
