#!/usr/bin/env python3
"""Diagnostic pass over the treadmill's FTMS characteristics.

Run this once before trusting the app with the real device (docs/DESIGN.md
sec. 1): it reports the advertised services, decodes the Feature
characteristic, and streams decoded Treadmill Data so you can verify flag
bits, distance resolution and reset behaviour with your own eyes.

    .venv/bin/python tools/probe_ftms.py            # scan and pick first FTMS device
    .venv/bin/python tools/probe_ftms.py AA:BB:...  # connect by address

Read-only: this never writes to the Control Point.
"""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ftms import (  # noqa: E402
    FITNESS_MACHINE_FEATURE_CHAR,
    FITNESS_MACHINE_SERVICE,
    FITNESS_MACHINE_STATUS_CHAR,
    TREADMILL_DATA_CHAR,
    decode_feature,
    parse_treadmill_data,
)


async def main(address: str | None) -> int:
    from bleak import BleakClient, BleakScanner

    if address:
        device = await BleakScanner.find_device_by_address(address, timeout=15)
    else:
        print("scanning for FTMS devices (15 s)…")
        found = await BleakScanner.discover(
            timeout=15, service_uuids=[FITNESS_MACHINE_SERVICE]
        )
        for d in found:
            print(f"  {d.address}  {d.name or '?'}")
        device = found[0] if found else None
    if device is None:
        print("no FTMS device found — is the treadmill on and FitShow closed?")
        return 1

    print(f"\nconnecting to {device.name or '?'} ({device.address})")
    async with BleakClient(device) as client:
        print("connected. services:")
        for service in client.services:
            print(f"  {service.uuid}  {service.description}")
            for ch in service.characteristics:
                print(f"    {ch.uuid}  props={','.join(ch.properties)}")

        try:
            raw = await client.read_gatt_char(FITNESS_MACHINE_FEATURE_CHAR)
            features = decode_feature(bytes(raw))
            print("\nFitness Machine Feature (0x2ACC):")
            print("  raw:", bytes(raw).hex())
            for k, v in features.items():
                print(f"  {k}: {', '.join(v) or '(none)'}")
            if features["target_setting_features"]:
                print(
                    "  NOTE: the Control Point accepts targets. This app stays "
                    "read-only regardless."
                )
        except Exception as exc:  # noqa: BLE001
            print(f"could not read Feature characteristic: {exc}")

        def on_status(_c, data: bytearray) -> None:
            print(f"[{datetime.now():%H:%M:%S}] STATUS 0x2ADA: {bytes(data).hex()}")

        def on_data(_c, data: bytearray) -> None:
            try:
                sample = parse_treadmill_data(data)
                print(
                    f"[{datetime.now():%H:%M:%S}] {bytes(data).hex():<44} "
                    f"{sample.as_dict()}"
                )
            except Exception as exc:  # noqa: BLE001
                print(f"[{datetime.now():%H:%M:%S}] UNDECODABLE {bytes(data).hex()}: {exc}")

        await client.start_notify(TREADMILL_DATA_CHAR, on_data)
        try:
            await client.start_notify(FITNESS_MACHINE_STATUS_CHAR, on_status)
        except Exception:  # noqa: BLE001
            pass

        print(
            "\nstreaming Treadmill Data — walk, stop, and power-cycle the "
            "console to observe reset behaviour. Ctrl-C to quit.\n"
        )
        while True:
            await asyncio.sleep(3600)
    return 0


if __name__ == "__main__":
    addr = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        raise SystemExit(asyncio.run(main(addr)))
    except KeyboardInterrupt:
        print("\nbye")
