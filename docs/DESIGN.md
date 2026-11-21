# Design notes

The engineering rationale behind Walkhome. The API/WebSocket contract lives in
`docs/CONTRACT.md`; this file explains *why* the backend behaves the way it does.

## 1. The treadmill: FTMS over Bluetooth Low Energy

Most connected treadmills expose the **Fitness Machine Service (FTMS, UUID 0x1826)**:

- **Treadmill Data (0x2ACD)**, a notify characteristic: a 16-bit flags field followed by the
  parameters announced by those flags (instantaneous speed, total distance, elapsed time,
  incline, heart rate…);
- **Fitness Machine Feature (0x2ACC)**, **Fitness Machine Status (0x2ADA)**;
- **Control Point (0x2AD9)**, which can set the target speed and incline.

Vendor details (flag bits actually used, distance resolution, what happens on a console reset)
vary from one device to another, so `tools/probe_ftms.py` exists: run it once against your
treadmill before trusting the app with it.

A treadmill accepts **one BLE central at a time**. If the vendor's phone app is open, it takes the
link and Walkhome sees a dropout: close the vendor app and let the Pi be the only client.

## 2. Safety: read-only by design

The Control Point can move the belt and change the incline. Walkhome **never writes to it**.
Every in-walk challenge is a "hold this pace yourself" challenge: the app *reads* speed and incline
and judges the result, it never drives the machine. This matters even more in a household with
children, and it is enforced in code review rather than configuration.

## 3. Distance accounting

This is the part that has to be right, because months of progress depend on it.

- **Primary source: integrated instantaneous speed** (Δdistance = speed × Δt between notifications).
  It is immune to console resets and gives smooth sub-second values for the live scene.
- **Cross-check: the treadmill's cumulative Total Distance field**, accumulated as **positive deltas
  only**. When the console resets, the field jumps back to zero: that is detected as "the cumulative
  value went down" and simply re-baselined, never subtracted. Within a session, the device value is
  used to correct slow integration drift (inside a bounded budget) and to recover metres walked
  during a BLE dropout.
- **Pause vs dropout.** A *pause* is a live link reporting speed 0. A *dropout* is the absence of
  notifications for a few seconds. They are distinct states, and neither counts distance.
- **Crash safety.** SQLite in WAL mode; the live session writes a checkpoint every few seconds, so a
  power cut or a reboot loses at most a few seconds and the walk resumes, attached to the same user.
- **Progress is derived, never stored.** Journey progress = Σ sessions + adjustments, × the walker's
  handicap. Deleting or correcting a session therefore just works, and rewards stay consistent
  because every grant is keyed and idempotent.
- **Time.** Timestamps are stored in UTC. "Today" and "this week" are computed in `WALKHOME_TZ`,
  never in the OS local time.

## 4. Many viewers, one source of truth

The Pi is the single source of truth; phones, tablets and TVs are views. Each client opens a
WebSocket, receives a full **snapshot** first and then incremental messages carrying a monotonically
increasing `seq`, so a phone that went to sleep resyncs cleanly. Commands (start, pause, stop, story
choices) go through the server, which serialises them. Private data is only ever sent to its owner.

## 5. Game design

- **A data-driven event engine.** The journey is an ordered list of events keyed to cumulative
  distance: short story beats, milestone cards, interactive challenges and occasional choices.
  Everything is data (`content/<theme>.json`), so a new theme is a new route and new prose.
- **Pacing a very long goal.** 780 km takes months on a treadmill, so the road is split into 4 stages and
  ~20 biomes, each with its own arrival, plus an ETA to the next milestone and visible near-term
  rewards (card packs every 2 km, daily and weekly quests, streaks).
- **Manual entries** (outdoor walks, sessions without the app) count for progress and the
  leaderboard but are capped for rewards, so they cannot be used to farm packs.

## 6. Running on a Raspberry Pi

- Python + FastAPI: one asyncio process owns the BLE central (`bleak`) and fans telemetry out over
  WebSocket; the React frontend is served as static files by the same process.
- systemd with `Restart=always`, journald with rate limits to spare the SD card, and a nightly
  `sqlite3 .backup` (`deploy/backup.sh`). Putting `data/` on a USB SSD is a good idea.
- HTTPS is required for Screen Wake Lock, service workers and an installable PWA on iOS. Tailscale
  (`tailscale cert` / `tailscale serve`) is the least-friction option on a home network; everything
  else works over plain HTTP.
