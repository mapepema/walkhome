/** In-browser fake backend: fetch routes + a fake WebSocket + a walk simulator. */
import type {
  AppNotification, ChallengeSnap, Journey, JourneyEvent, Me, PackGrant, PublicProfile,
  SessionRow, SessionSnap, Snapshot, Subject,
} from "../types"
import { ME, PLAYERS, THEMES, JOURNEYS, fakeCard, grants, iso, leaderRows, makeNotifs, makeQuests, makeSessions } from "./data"

const EVERY = 2000
const flags = new URLSearchParams(location.search)

export class MockServer {
  me: Me = { ...ME }
  loggedIn = flags.get("mock") !== "anon" && sessionStorage.getItem("wh-mock-out") !== "1"
  progress = 214_300
  sessions = makeSessions()
  quests = makeQuests()
  notifs: AppNotification[] = makeNotifs()
  unopened: PackGrant[] = grants(2)
  session: SessionSnap | null = null
  busyBy: PublicProfile | null = flags.get("busy") ? PLAYERS[1] : null
  listeners = new Set<FakeWebSocket>()
  seq = 1
  timer: number | null = null
  nextPackAt = 0
  sinceTick = 0

  journey(): Journey {
    return JOURNEYS[this.me.journey_id] ?? JOURNEYS.camino
  }

  subject(progress = this.progress): Subject {
    const j = this.journey()
    const biome = j.biomes.find((b) => progress >= b.start_m && progress < b.end_m) ?? j.biomes[0]
    const stage = j.stages.find((s) => progress >= s.start_m && progress < s.end_m) ?? j.stages[0]
    const ms = j.events.filter((e) => e.kind === "milestone")
    const next = ms.find((e) => e.at_m > progress) ?? null
    const last = [...j.events].reverse().find((e) => e.at_m <= progress) ?? null
    return {
      kind: "user", id: this.me.id, journey_id: j.id, progress_m: progress, fraction: progress / j.total_m,
      remaining_m: j.total_m - progress, biome, stage, last_event: last, next_milestone: next,
      next_milestone_in_m: next ? next.at_m - progress : null, finished: false, pace_m_per_day: 2650,
      eta_days_to_milestone: next ? (next.at_m - progress) / 2650 : undefined,
      eta_days_to_finish: (j.total_m - progress) / 2650, display_name: this.me.display_name,
      avatar: this.me.avatar, color: this.me.color, handicap: 1, daily_goal_m: this.me.daily_goal_m,
    }
  }

  snapshot(): Snapshot {
    const nextIn = EVERY - ((this.progress - 1000) % EVERY)
    return {
      me: { ...this.me, unopened_packs: this.unopened.length, journey_id: this.me.journey_id },
      journey_id: this.me.journey_id, units: this.me.units,
      link: { state: "live", detail: "Simulated treadmill", source: "sim" },
      treadmill: { busy: !!this.busyBy, walker: this.busyBy },
      session: this.session, subject: this.subject(),
      packs: { unopened: this.unopened.length, next_pack_in_m: nextIn, pack_every_m: EVERY },
      rank: { week: 4, all: 4, total: PLAYERS.length },
      unread_notifications: this.notifs.filter((n) => !n.read).length,
    }
  }

  /* ------------------------------------------------------------- ws -- */
  emit(type: string, data: unknown) {
    const env = JSON.stringify({ type, seq: this.seq++, server_time: iso(new Date()), data })
    this.listeners.forEach((l) => l.deliver(env))
  }

  attach(ws: FakeWebSocket) {
    this.listeners.add(ws)
    setTimeout(() => {
      if (!this.loggedIn) return ws.fail(4401)
      ws.open()
      this.emit("snapshot", this.snapshot())
      this.emit("live", { walkers: this.walkers() })
    }, 60)
  }

  walkers() {
    return PLAYERS.filter((p) => p.walking_now && p.id !== 1).map((p) => ({
      user_id: p.id, display_name: p.display_name, avatar: p.avatar, color: p.color, speed_kmh: 4.8,
    }))
  }

  /* --------------------------------------------------- walk simulator -- */
  startSim() {
    this.stopSim()
    this.timer = window.setInterval(() => this.step(), 1000)
  }
  stopSim() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  step() {
    const s = this.session
    if (!s) return
    if (s.state === "active") {
      const speed = 4.6 + Math.sin(Date.now() / 6000) * 0.5
      const dm = (speed / 3.6) * 1
      const t = s.telemetry
      t.distance_m += dm
      t.integrated_m += dm
      t.elapsed_s += 1
      t.moving_s += 1
      t.speed_kmh = +speed.toFixed(2)
      t.max_speed_kmh = Math.max(t.max_speed_kmh, t.speed_kmh)
      t.samples += 1
      s.heart_rate_bpm = Math.round(112 + Math.sin(Date.now() / 9000) * 9 + t.elapsed_s * 0.05)
      const before = this.progress
      this.progress += dm
      s.progress_m = this.progress
      s.fraction = this.progress / this.journey().total_m
      const sub = this.subject()
      s.biome = sub.biome
      s.stage = sub.stage
      s.next_milestone = sub.next_milestone
      this.tickChallenge(s)
      if (Math.floor((before - 1000) / EVERY) < Math.floor((this.progress - 1000) / EVERY)) this.reward("distance")
    }
    this.emit("tick", this.snapshot())
  }

  tickChallenge(s: SessionSnap) {
    const el = s.telemetry.elapsed_s
    if (!s.challenge && el === 40) s.challenge = this.makeChallenge()
    const c = s.challenge
    if (c && c.state === "running") {
      c.held_s += 1
      c.remaining_s = Math.max(0, c.duration_s - c.held_s)
      c.progress = c.held_s / c.duration_s
      if (c.remaining_s <= 0) {
        this.emit("challenge", { title: c.title, icon: c.icon, succeeded: true, text: "You held on: the road opens up ahead.", held_s: c.duration_s })
        s.challenge = null
      }
    }
  }

  makeChallenge(): ChallengeSnap {
    return {
      event_id: "mock-ch", title: "Quick step", icon: "⚡", kind: "speed", state: "running", target: "Hold 4.5 km/h for 90 s",
      note: "", fallback_used: false, duration_s: 90, held_s: 24, progress: 24 / 90, remaining_s: 66, min_speed_kmh: 4.5, min_incline_pct: null,
    }
  }

  reward(source: string) {
    const g = grants(1, source)
    this.unopened.push(...g)
    this.emit("reward", { grants: g, reason: source, title: source === "distance" ? "Distance pack" : "Reward" })
  }

  /** Demo helpers for screenshots / manual testing: window.__mock.* */
  demo = {
    reward: () => this.reward("distance"),
    rank: (kind: "overtook" | "overtaken" = "overtook") =>
      this.emit("rank", kind === "overtook"
        ? { journey_id: "camino", rank: 3, previous_rank: 4, overtook: PLAYERS[2] }
        : { journey_id: "camino", rank: 5, previous_rank: 4, overtaken_by: PLAYERS[4] }),
    notify: () => {
      const n: AppNotification = { id: Date.now(), kind: "quest", title: "Quest ready", body: "\u201cSteady pace\u201d can be claimed.", icon: "📜", created_utc: iso(new Date()), read: false }
      this.notifs.unshift(n)
      this.emit("notify", n)
    },
    event: () => {
      const j = this.journey()
      const ev = j.events.find((e) => e.kind === "beat") as JourneyEvent
      this.emit("event", { subject: { kind: "user", id: 1 }, event: { ...ev, id: "mock-" + Date.now() }, at_m: this.progress })
    },
    choice: () => {
      if (!this.session) return
      this.session.pending_choice = {
        event_id: "mock-choice", title: "A crossroads in the mist",
        body: "Two paths open before you. One follows the river, the other climbs toward the ridge.",
        options: [
          { id: "river", label: "Follow the river", detail: "Calmer, longer" },
          { id: "ridge", label: "Climb the ridge", detail: "A risk, a reward" },
        ],
      }
      this.emit("tick", this.snapshot())
    },
    challenge: () => { if (this.session) { this.session.challenge = this.makeChallenge(); this.emit("tick", this.snapshot()) } },
    busy: (on = true) => { this.busyBy = on ? PLAYERS[1] : null; this.emit("snapshot", this.snapshot()) },
  }

  newSession(): SessionSnap {
    const sub = this.subject()
    return {
      id: 900, user: { id: 1, display_name: this.me.display_name, avatar: this.me.avatar, color: this.me.color, handicap: 1 },
      journey_id: this.me.journey_id, state: "active", manual_pause: false, started_at: iso(new Date()),
      telemetry: { distance_m: 0, integrated_m: 0, device_m: null, drift_m: null, elapsed_s: 0, moving_s: 0, speed_kmh: 0, max_speed_kmh: 0, avg_hr_bpm: null, samples: 0, resets_seen: 0, gaps_seen: 0 },
      incline_pct: 0, heart_rate_bpm: 110, progress_m: this.progress, fraction: sub.fraction, biome: sub.biome, stage: sub.stage,
      next_milestone: sub.next_milestone, challenge: null, pending_choice: null,
    }
  }
}

export class FakeWebSocket extends EventTarget {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
  readyState = 0
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  url: string
  private srv: MockServer
  constructor(url: string, srv: MockServer) {
    super()
    this.url = url
    this.srv = srv
    srv.attach(this)
  }
  open() { this.readyState = 1; this.onopen?.(new Event("open")) }
  deliver(data: string) { if (this.readyState === 1) this.onmessage?.(new MessageEvent("message", { data })) }
  fail(code: number) { this.readyState = 3; this.srv.listeners.delete(this); this.onclose?.({ code } as CloseEvent) }
  send(msg: string) { if (msg === "resync") this.srv.emit("snapshot", this.srv.snapshot()) }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.srv.listeners.delete(this); this.onclose?.({ code: 1000 } as CloseEvent) } }
}

export { THEMES, fakeCard, leaderRows }
export type { SessionRow }
