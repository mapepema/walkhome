"""Bluetooth Fitness Machine Service (FTMS) decoding.

Only the read paths are implemented. The Control Point (0x2AD9) can move the
belt and change incline, so this application never writes to it -- see
``docs/DESIGN.md`` sec. 2 for the safety rationale.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

FITNESS_MACHINE_SERVICE = "00001826-0000-1000-8000-00805f9b34fb"
TREADMILL_DATA_CHAR = "00002acd-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_FEATURE_CHAR = "00002acc-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_STATUS_CHAR = "00002ada-0000-1000-8000-00805f9b34fb"
FITNESS_MACHINE_CONTROL_POINT_CHAR = "00002ad9-0000-1000-8000-00805f9b34fb"
HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HEART_RATE_MEASUREMENT_CHAR = "00002a37-0000-1000-8000-00805f9b34fb"

# Treadmill Data flag bits. Note bit 0 is inverted: "More Data" == 0 means the
# Instantaneous Speed field IS present (it is present in every first packet).
FLAG_MORE_DATA = 1 << 0
FLAG_AVERAGE_SPEED = 1 << 1
FLAG_TOTAL_DISTANCE = 1 << 2
FLAG_INCLINATION = 1 << 3
FLAG_ELEVATION_GAIN = 1 << 4
FLAG_INSTANTANEOUS_PACE = 1 << 5
FLAG_AVERAGE_PACE = 1 << 6
FLAG_EXPENDED_ENERGY = 1 << 7
FLAG_HEART_RATE = 1 << 8
FLAG_METABOLIC_EQUIVALENT = 1 << 9
FLAG_ELAPSED_TIME = 1 << 10
FLAG_REMAINING_TIME = 1 << 11
FLAG_FORCE_ON_BELT = 1 << 12


class FtmsDecodeError(ValueError):
    """Raised when a notification payload is too short for its own flags."""


@dataclass(frozen=True)
class TreadmillSample:
    """One decoded Treadmill Data (0x2ACD) notification.

    Speeds are km/h, distances metres, times seconds, incline percent.
    Any field the treadmill did not report stays ``None``.
    """

    speed_kmh: float | None = None
    avg_speed_kmh: float | None = None
    total_distance_m: int | None = None
    inclination_pct: float | None = None
    ramp_angle_deg: float | None = None
    positive_elevation_gain_m: float | None = None
    negative_elevation_gain_m: float | None = None
    instantaneous_pace_min_km: float | None = None
    average_pace_min_km: float | None = None
    total_energy_kcal: int | None = None
    energy_per_hour_kcal: int | None = None
    energy_per_minute_kcal: int | None = None
    heart_rate_bpm: int | None = None
    metabolic_equivalent: float | None = None
    elapsed_time_s: int | None = None
    remaining_time_s: int | None = None
    force_on_belt_n: int | None = None
    power_w: int | None = None
    raw: bytes = b""

    def as_dict(self) -> dict:
        out = {
            k: v
            for k, v in self.__dict__.items()
            if k != "raw" and v is not None
        }
        return out


class _Reader:
    __slots__ = ("buf", "pos")

    def __init__(self, buf: bytes, pos: int = 0) -> None:
        self.buf = buf
        self.pos = pos

    def _take(self, n: int) -> bytes:
        end = self.pos + n
        if end > len(self.buf):
            raise FtmsDecodeError(
                f"payload truncated: need {n} bytes at offset {self.pos}, "
                f"have {len(self.buf) - self.pos}"
            )
        chunk = self.buf[self.pos : end]
        self.pos = end
        return chunk

    def u8(self) -> int:
        return self._take(1)[0]

    def u16(self) -> int:
        return struct.unpack("<H", self._take(2))[0]

    def s16(self) -> int:
        return struct.unpack("<h", self._take(2))[0]

    def u24(self) -> int:
        b = self._take(3)
        return b[0] | (b[1] << 8) | (b[2] << 16)


def parse_treadmill_data(payload: bytes | bytearray | memoryview) -> TreadmillSample:
    """Decode a 0x2ACD notification into a :class:`TreadmillSample`.

    Fields appear in the fixed order given by the FTMS spec; each is present
    only when its flag bit says so, so the payload must be walked in order.
    """
    data = bytes(payload)
    if len(data) < 2:
        raise FtmsDecodeError("payload shorter than the 2-octet flags field")

    flags = struct.unpack("<H", data[:2])[0]
    r = _Reader(data, 2)
    values: dict[str, object] = {"raw": data}

    if not flags & FLAG_MORE_DATA:
        values["speed_kmh"] = r.u16() / 100.0
    if flags & FLAG_AVERAGE_SPEED:
        values["avg_speed_kmh"] = r.u16() / 100.0
    if flags & FLAG_TOTAL_DISTANCE:
        values["total_distance_m"] = r.u24()
    if flags & FLAG_INCLINATION:
        values["inclination_pct"] = r.s16() / 10.0
        values["ramp_angle_deg"] = r.s16() / 10.0
    if flags & FLAG_ELEVATION_GAIN:
        values["positive_elevation_gain_m"] = r.u16() / 10.0
        values["negative_elevation_gain_m"] = r.u16() / 10.0
    if flags & FLAG_INSTANTANEOUS_PACE:
        values["instantaneous_pace_min_km"] = r.u8() / 10.0
    if flags & FLAG_AVERAGE_PACE:
        values["average_pace_min_km"] = r.u8() / 10.0
    if flags & FLAG_EXPENDED_ENERGY:
        values["total_energy_kcal"] = r.u16()
        values["energy_per_hour_kcal"] = r.u16()
        values["energy_per_minute_kcal"] = r.u8()
    if flags & FLAG_HEART_RATE:
        values["heart_rate_bpm"] = r.u8()
    if flags & FLAG_METABOLIC_EQUIVALENT:
        values["metabolic_equivalent"] = r.u8() / 10.0
    if flags & FLAG_ELAPSED_TIME:
        values["elapsed_time_s"] = r.u16()
    if flags & FLAG_REMAINING_TIME:
        values["remaining_time_s"] = r.u16()
    if flags & FLAG_FORCE_ON_BELT:
        values["force_on_belt_n"] = r.s16()
        values["power_w"] = r.s16()

    return TreadmillSample(**values)  # type: ignore[arg-type]


def encode_treadmill_data(
    *,
    speed_kmh: float | None = None,
    total_distance_m: int | None = None,
    inclination_pct: float | None = None,
    heart_rate_bpm: int | None = None,
    elapsed_time_s: int | None = None,
) -> bytes:
    """Build a 0x2ACD payload. Used by the simulator and by the tests."""
    flags = 0
    body = b""

    if speed_kmh is None:
        flags |= FLAG_MORE_DATA
    else:
        body += struct.pack("<H", max(0, round(speed_kmh * 100)))
    if total_distance_m is not None:
        flags |= FLAG_TOTAL_DISTANCE
        d = max(0, int(total_distance_m)) & 0xFFFFFF
        body += bytes((d & 0xFF, (d >> 8) & 0xFF, (d >> 16) & 0xFF))
    if inclination_pct is not None:
        flags |= FLAG_INCLINATION
        body += struct.pack("<hh", round(inclination_pct * 10), 0)
    if heart_rate_bpm is not None:
        flags |= FLAG_HEART_RATE
        body += struct.pack("<B", max(0, min(255, int(heart_rate_bpm))))
    if elapsed_time_s is not None:
        flags |= FLAG_ELAPSED_TIME
        body += struct.pack("<H", max(0, min(0xFFFF, int(elapsed_time_s))))

    return struct.pack("<H", flags) + body


# Fitness Machine Feature (0x2ACC), first uint32. Used by the probe tool to
# report what the treadmill claims to support.
FEATURE_BITS = {
    0: "Average Speed",
    1: "Cadence",
    2: "Total Distance",
    3: "Inclination",
    4: "Elevation Gain",
    5: "Pace",
    6: "Step Count",
    7: "Resistance Level",
    8: "Stride Count",
    9: "Expended Energy",
    10: "Heart Rate Measurement",
    11: "Metabolic Equivalent",
    12: "Elapsed Time",
    13: "Remaining Time",
    14: "Power Measurement",
    15: "Force on Belt and Power Output",
    16: "User Data Retention",
}

TARGET_SETTING_BITS = {
    0: "Speed Target Setting",
    1: "Inclination Target Setting",
    2: "Resistance Target Setting",
    3: "Power Target Setting",
    4: "Heart Rate Target Setting",
    5: "Targeted Expended Energy Configuration",
    6: "Targeted Step Number Configuration",
    7: "Targeted Stride Number Configuration",
    8: "Targeted Distance Configuration",
    9: "Targeted Training Time Configuration",
}


def decode_feature(payload: bytes) -> dict[str, list[str]]:
    """Decode 0x2ACC into human-readable capability lists."""
    if len(payload) < 8:
        raise FtmsDecodeError("feature characteristic must be 8 octets")
    machine, target = struct.unpack("<II", payload[:8])
    return {
        "machine_features": [n for b, n in FEATURE_BITS.items() if machine & (1 << b)],
        "target_setting_features": [
            n for b, n in TARGET_SETTING_BITS.items() if target & (1 << b)
        ],
    }


def parse_heart_rate_measurement(payload: bytes) -> int | None:
    """Decode a 0x2A37 Heart Rate Measurement notification."""
    if len(payload) < 2:
        return None
    flags = payload[0]
    if flags & 0x01:
        if len(payload) < 3:
            return None
        return struct.unpack("<H", payload[1:3])[0]
    return payload[1]
