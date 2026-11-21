import pytest

from app.ftms import (
    FtmsDecodeError,
    decode_feature,
    encode_treadmill_data,
    parse_heart_rate_measurement,
    parse_treadmill_data,
)


def test_roundtrip_full_packet():
    payload = encode_treadmill_data(
        speed_kmh=5.6,
        total_distance_m=1234,
        inclination_pct=2.5,
        heart_rate_bpm=132,
        elapsed_time_s=600,
    )
    s = parse_treadmill_data(payload)
    assert s.speed_kmh == pytest.approx(5.6)
    assert s.total_distance_m == 1234
    assert s.inclination_pct == pytest.approx(2.5)
    assert s.heart_rate_bpm == 132
    assert s.elapsed_time_s == 600


def test_speed_only_packet():
    s = parse_treadmill_data(encode_treadmill_data(speed_kmh=4.0))
    assert s.speed_kmh == pytest.approx(4.0)
    assert s.total_distance_m is None
    assert s.inclination_pct is None


def test_more_data_flag_omits_speed():
    payload = encode_treadmill_data(speed_kmh=None, total_distance_m=99)
    s = parse_treadmill_data(payload)
    assert s.speed_kmh is None
    assert s.total_distance_m == 99


def test_distance_is_24_bit():
    s = parse_treadmill_data(
        encode_treadmill_data(speed_kmh=1.0, total_distance_m=0xFFFFFF)
    )
    assert s.total_distance_m == 0xFFFFFF


def test_truncated_packet_raises():
    good = encode_treadmill_data(speed_kmh=5.0, total_distance_m=1000)
    with pytest.raises(FtmsDecodeError):
        parse_treadmill_data(good[:-2])


def test_too_short_raises():
    with pytest.raises(FtmsDecodeError):
        parse_treadmill_data(b"\x00")


def test_zero_speed():
    s = parse_treadmill_data(encode_treadmill_data(speed_kmh=0.0))
    assert s.speed_kmh == 0.0


def test_feature_decode():
    # bits 2 (Total Distance) and 3 (Inclination) set; no target features
    payload = bytes([0b00001100, 0, 0, 0, 0, 0, 0, 0])
    features = decode_feature(payload)
    assert "Total Distance" in features["machine_features"]
    assert "Inclination" in features["machine_features"]
    assert features["target_setting_features"] == []


def test_heart_rate_uint8_and_uint16():
    assert parse_heart_rate_measurement(bytes([0x00, 140])) == 140
    assert parse_heart_rate_measurement(bytes([0x01, 0x2C, 0x01])) == 300
    assert parse_heart_rate_measurement(b"\x00") is None
