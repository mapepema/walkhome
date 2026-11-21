"""Telemetry sources.

The real one owns a single BLE central connection to the treadmill; the
simulator produces the same decoded samples with no hardware, which is what
makes the dropout / console-reset / reboot behaviour testable and what lets
the family app be developed and demoed away from the machine.

Only one BLE central may talk to an FTMS treadmill at a time -- if the vendor
app (FitShow) is opened on a phone it will steal the link. That shows up here
as a disconnect, and the UI says so in plain words.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import random
import time
from typing import Awaitable, Callable, Protocol

from .ftms import (
    FITNESS_MACHINE_FEATURE_CHAR,
    FITNESS_MACHINE_SERVICE,
    HEART_RATE_MEASUREMENT_CHAR,
    TREADMILL_DATA_CHAR,
    FtmsDecodeError,
    TreadmillSample,
    decode_feature,
    encode_treadmill_data,
    parse_heart_rate_measurement,
    parse_treadmill_data,
)

log = logging.getLogger(__name__)

SampleHandler = Callable[[TreadmillSample], None]
LinkHandler = Callable[[bool, str], None]


class TelemetrySource(Protocol):
    kind: str

    async def run(self, on_sample: SampleHandler, on_link: LinkHandler) -> None: ...
    async def stop(self) -> None: ...
    def status(self) -> dict: ...


class NullTelemetrySource:
    """No treadmill. Manual entry still works."""

    kind = "off"

    def __init__(self) -> None:
        self._stop = asyncio.Event()

    async def run(self, on_sample: SampleHandler, on_link: LinkHandler) -> None:
        on_link(False, "Telemetry disabled (manual entry only)")
        await self._stop.wait()

    async def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {"kind": self.kind, "connected": False, "detail": "disabled"}


class SimulatedTelemetrySource:
    """A treadmill that lives in software.

    Speed is settable at runtime (``/api/dev/sim``), and both nasty real-world
    behaviours can be injected on demand: a link dropout, and the console
    cumulative-distance field resetting to zero.
    """

    kind = "sim"

    def __init__(self, interval_s: float = 1.0, start_speed_kmh: float = 5.0) -> None:
        self.interval_s = interval_s
        self.speed_kmh = start_speed_kmh
        self.incline_pct = 0.0
        self.auto = True  # gentle drift so the demo looks alive
        self._total_m = 0.0
        self._elapsed = 0.0
        self._connected = False
        self._link_down_until = 0.0
        self._stop = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._rng = random.Random(7)

    # --- controls ----------------------------------------------------------

    def set_speed(self, kmh: float) -> None:
        self.speed_kmh = max(0.0, min(25.0, float(kmh)))
        self.auto = False

    def set_incline(self, pct: float) -> None:
        self.incline_pct = max(0.0, min(20.0, float(pct)))

    def drop_link(self, seconds: float = 10.0) -> None:
        self._link_down_until = time.monotonic() + max(0.0, seconds)

    def reset_console(self) -> None:
        """Emulate a power cycle: the cumulative field jumps back to zero."""
        self._total_m = 0.0

    # --- source protocol ---------------------------------------------------

    async def run(self, on_sample: SampleHandler, on_link: LinkHandler) -> None:
        self._connected = True
        on_link(True, "Simulated treadmill connected")
        hr_phase = 0.0
        try:
            while not self._stop.is_set():
                await asyncio.sleep(self.interval_s)
                now = time.monotonic()
                if now < self._link_down_until:
                    if self._connected:
                        self._connected = False
                        on_link(False, "Simulated link dropped")
                    # The belt keeps running while we are not listening --
                    # that is exactly the distance reconciliation must recover.
                    self._advance()
                    continue
                if not self._connected:
                    self._connected = True
                    on_link(True, "Simulated treadmill reconnected")

                self._advance()
                hr_phase += 0.15
                payload = encode_treadmill_data(
                    speed_kmh=self.speed_kmh,
                    total_distance_m=int(self._total_m),
                    inclination_pct=self.incline_pct,
                    heart_rate_bpm=int(
                        95 + self.speed_kmh * 6 + 4 * math.sin(hr_phase)
                    )
                    if self.speed_kmh > 0
                    else 70,
                    elapsed_time_s=int(self._elapsed),
                )
                on_sample(parse_treadmill_data(payload))
        finally:
            self._connected = False
            on_link(False, "Simulator stopped")

    def _advance(self) -> None:
        if self.auto:
            self.speed_kmh = max(
                0.0, min(9.0, self.speed_kmh + self._rng.uniform(-0.25, 0.25))
            )
        self._elapsed += self.interval_s
        self._total_m += self.speed_kmh * (1000.0 / 3600.0) * self.interval_s

    async def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {
            "kind": self.kind,
            "connected": self._connected,
            "detail": "simulated treadmill",
            "speed_kmh": round(self.speed_kmh, 2),
            "incline_pct": self.incline_pct,
            "device_total_m": round(self._total_m, 1),
        }


class BleTelemetrySource:
    """Supervised BLE central for a real FTMS treadmill.

    Reconnects with exponential backoff and never resets the caller's
    accumulator on reconnect -- recovery of the missed metres is the
    tracker's job, via the cumulative-distance cross-check.
    """

    kind = "ble"

    def __init__(
        self,
        address: str | None = None,
        name_hint: str = "",
        scan_timeout_s: float = 12.0,
        backoff_min_s: float = 1.0,
        backoff_max_s: float = 30.0,
    ) -> None:
        self.address = address
        self.name_hint = name_hint.lower()
        self.scan_timeout_s = scan_timeout_s
        self.backoff_min_s = backoff_min_s
        self.backoff_max_s = backoff_max_s

        self._stop = asyncio.Event()
        self._connected = False
        self._device_name: str | None = None
        self._features: dict | None = None
        self._last_error: str = ""
        self._attempts = 0

    async def run(self, on_sample: SampleHandler, on_link: LinkHandler) -> None:
        backoff = self.backoff_min_s
        while not self._stop.is_set():
            try:
                await self._connect_once(on_sample, on_link)
                backoff = self.backoff_min_s  # a clean session resets backoff
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - supervisor must not die
                self._last_error = str(exc)
                log.warning("treadmill link failed: %s", exc)
            finally:
                if self._connected:
                    self._connected = False
                    on_link(False, self._last_error or "Treadmill disconnected")

            if self._stop.is_set():
                break
            self._attempts += 1
            jitter = random.uniform(0, backoff * 0.25)
            await self._sleep_or_stop(backoff + jitter)
            backoff = min(self.backoff_max_s, backoff * 2)

    async def _sleep_or_stop(self, seconds: float) -> None:
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(self._stop.wait(), timeout=seconds)

    async def _connect_once(
        self, on_sample: SampleHandler, on_link: LinkHandler
    ) -> None:
        from bleak import BleakClient, BleakScanner

        device = None
        if self.address:
            device = await BleakScanner.find_device_by_address(
                self.address, timeout=self.scan_timeout_s
            )
            if device is None:
                # An FTMS treadmill stops advertising while any central holds a
                # link -- including a stale BlueZ connection left by a crashed
                # process on this very Pi. Clearing it is harmless if there is
                # none, and unsticks the common failure mode if there is.
                await self._clear_stale_bluez_connection()
                raise RuntimeError(f"treadmill {self.address} not found in scan")
        else:
            candidates = await BleakScanner.discover(
                timeout=self.scan_timeout_s, service_uuids=[FITNESS_MACHINE_SERVICE]
            )
            for candidate in candidates:
                name = (candidate.name or "").lower()
                if not self.name_hint or self.name_hint in name:
                    device = candidate
                    break
            if device is None:
                raise RuntimeError("no FTMS treadmill advertising nearby")

        self._device_name = device.name or device.address
        log.info("connecting to treadmill %s (%s)", self._device_name, device.address)

        disconnected = asyncio.Event()

        def _on_disconnect(_client) -> None:
            log.info("treadmill link lost")
            disconnected.set()

        async with BleakClient(device, disconnected_callback=_on_disconnect) as client:
            self._connected = True
            self._last_error = ""
            on_link(True, f"Connected to {self._device_name}")

            with contextlib.suppress(Exception):
                raw = await client.read_gatt_char(FITNESS_MACHINE_FEATURE_CHAR)
                self._features = decode_feature(bytes(raw))
                log.info("treadmill features: %s", self._features)

            def _handle_treadmill(_char, data: bytearray) -> None:
                try:
                    on_sample(parse_treadmill_data(data))
                except FtmsDecodeError as exc:
                    log.warning("undecodable treadmill packet %s: %s", bytes(data).hex(), exc)

            await client.start_notify(TREADMILL_DATA_CHAR, _handle_treadmill)

            # Some treadmills expose heart rate on a separate service; take it
            # if it is there, ignore it if it is not.
            def _handle_hr(_char, data: bytearray) -> None:
                bpm = parse_heart_rate_measurement(bytes(data))
                if bpm:
                    on_sample(TreadmillSample(heart_rate_bpm=bpm))

            with contextlib.suppress(Exception):
                await client.start_notify(HEART_RATE_MEASUREMENT_CHAR, _handle_hr)

            stopper = asyncio.create_task(self._stop.wait())
            dropper = asyncio.create_task(disconnected.wait())
            try:
                await asyncio.wait(
                    {stopper, dropper}, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                for task in (stopper, dropper):
                    task.cancel()
                with contextlib.suppress(Exception):
                    await client.stop_notify(TREADMILL_DATA_CHAR)

    async def _clear_stale_bluez_connection(self) -> None:
        """Best-effort ``bluetoothctl disconnect`` for a leftover link."""
        if not self.address:
            return
        try:
            proc = await asyncio.create_subprocess_exec(
                "bluetoothctl", "disconnect", self.address,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=10)
        except (FileNotFoundError, asyncio.TimeoutError, OSError):
            pass

    async def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict:
        return {
            "kind": self.kind,
            "connected": self._connected,
            "device": self._device_name,
            "address": self.address,
            "features": self._features,
            "attempts": self._attempts,
            "detail": self._last_error or ("connected" if self._connected else "searching"),
        }


def build_source(config) -> TelemetrySource:
    mode = (config.ble_mode or "sim").lower()
    if mode in {"off", "none", "manual"}:
        return NullTelemetrySource()
    if mode in {"sim", "simulator", "fake"}:
        return SimulatedTelemetrySource(interval_s=1.0)
    return BleTelemetrySource(
        address=config.device_address,
        name_hint=config.device_name_hint,
        scan_timeout_s=config.scan_timeout_s,
        backoff_min_s=config.reconnect_min_s,
        backoff_max_s=config.reconnect_max_s,
    )
