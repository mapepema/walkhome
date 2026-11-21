import { MockServer, THEMES, fakeCard, leaderRows } from "./server"
import { JOURNEYS, PLAYERS, iso } from "./data"
import type { CardCatalog, DailyRow, SessionRow } from "../types"

type Res = { status: number; body: unknown }
const ok = (body: unknown): Res => ({ status: 200, body })
const err = (status: number, detail: string, code?: string): Res => ({ status, body: { detail, code } })

export function route(srv: MockServer, method: string, path: string, body: any): Res {
  const [p, qs = ""] = path.split("?")
  const q = new URLSearchParams(qs)
  const m = (re: RegExp) => p.match(re)

  if (p === "/themes") return ok(THEMES)
  if (p === "/health") return ok({ ok: true })
  if (p === "/auth/login") {
    if (!body.password || body.password.length < 4) return err(401, "Invalid credentials")
    srv.loggedIn = true; sessionStorage.removeItem("wh-mock-out")
    return ok(srv.me)
  }
  if (p === "/auth/register") {
    srv.me = { ...srv.me, username: body.username, display_name: body.username, journey_id: body.journey_id, avatar: body.avatar ?? "🧙", color: body.color ?? "#e3b45c" }
    srv.loggedIn = true; sessionStorage.removeItem("wh-mock-out")
    return ok(srv.me)
  }
  if (p === "/auth/logout") { srv.loggedIn = false; sessionStorage.setItem("wh-mock-out", "1"); return ok({ ok: true }) }
  if (!srv.loggedIn) return err(401, "Not signed in")
  if (p === "/auth/me" || p === "/me") {
    if (method === "PATCH") {
      srv.me = { ...srv.me, ...body }
      return ok(srv.me)
    }
    return ok({ ...srv.me, unopened_packs: srv.unopened.length })
  }
  if (p === "/me/password") return body.old === "wrong" ? err(400, "Current password is incorrect") : ok({ ok: true })
  if (p === "/me/state") return ok(srv.snapshot())
  let r
  if ((r = m(/^\/journeys\/(\w+)$/))) return JOURNEYS[r[1]] ? ok(JOURNEYS[r[1]]) : err(404, "Not found")

  // walking
  if (p === "/me/walk/start") {
    if (srv.busyBy) return err(409, "The treadmill is busy", "treadmill_busy")
    srv.session = srv.newSession(); srv.startSim(); srv.emit("snapshot", srv.snapshot()); return ok({ ok: true })
  }
  if (p === "/me/walk/pause" || p === "/me/walk/resume") {
    if (srv.session) { srv.session.manual_pause = p.endsWith("pause"); srv.session.state = srv.session.manual_pause ? "paused" : "active" }
    srv.emit("tick", srv.snapshot()); return ok({ ok: true })
  }
  if (p === "/me/walk/stop") {
    const t = srv.session?.telemetry
    const out = { distance_m: t?.distance_m ?? 0, moving_s: t?.moving_s ?? 0, elapsed_s: t?.elapsed_s ?? 0 }
    if (t && t.distance_m > 50) {
      const now = new Date()
      srv.sessions.unshift({ id: Date.now(), user_id: 1, journey_id: srv.me.journey_id, source: "treadmill", state: "ended", start_utc: iso(new Date(now.getTime() - t.elapsed_s * 1000)), end_utc: iso(now), distance_m: Math.round(t.distance_m), elapsed_s: t.elapsed_s, moving_s: t.moving_s, note: body?.note ?? null })
    }
    srv.session = null; srv.stopSim(); srv.emit("snapshot", srv.snapshot()); return ok(out)
  }
  if (p === "/me/walk/choice") {
    if (srv.session) srv.session.pending_choice = null
    srv.emit("tick", srv.snapshot())
    return ok({ option: { label: body.option_id === "river" ? "Follow the river" : "Climb the ridge", outcome: "The path turns out lovelier than expected." } })
  }
  if (p === "/me/sessions/manual") {
    const d = Number(body.distance_m), min = Number(body.minutes)
    if (!(d > 0)) return err(400, "Invalid distance")
    if (d / 1000 / (min / 60) > 400) return err(400, "Implied speed too high")
    srv.progress += d
    srv.sessions.unshift({ id: Date.now(), user_id: 1, journey_id: srv.me.journey_id, source: "manual", state: "ended", start_utc: body.when_utc ?? iso(new Date()), end_utc: null, distance_m: d, elapsed_s: min * 60, moving_s: min * 60, note: body.note ?? null })
    srv.emit("snapshot", srv.snapshot())
    return ok({ ok: true })
  }
  if (p === "/me/sessions") {
    const lim = Number(q.get("limit") ?? 50)
    return ok(srv.sessions.slice(0, lim))
  }
  if ((r = m(/^\/me\/sessions\/(\d+)$/))) {
    const id = Number(r[1]); const i = srv.sessions.findIndex((s) => s.id === id)
    if (i < 0) return err(404, "Session not found")
    if (method === "DELETE") { srv.sessions.splice(i, 1); return ok({ ok: true }) }
    srv.sessions[i] = { ...srv.sessions[i], note: body.note ?? srv.sessions[i].note } as SessionRow
    return ok(srv.sessions[i])
  }
  if (p === "/me/daily") {
    const days = Number(q.get("days") ?? 30)
    const map = new Map<string, DailyRow>()
    const since = Date.now() - days * 864e5
    for (const s of srv.sessions) {
      if (new Date(s.start_utc).getTime() < since) continue
      const d = s.start_utc.slice(0, 10)
      const row = map.get(d) ?? { day: d, distance_m: 0, sessions: 0 }
      row.distance_m += s.distance_m; row.sessions++; map.set(d, row)
    }
    return ok([...map.values()].sort((a, b) => a.day.localeCompare(b.day)))
  }
  if (p === "/me/streak") return ok({ days: 6, grace_used: 0, last_walk: iso(new Date()).slice(0, 10), best: 21 })
  if (p === "/me/journal") {
    const j = srv.journey()
    const done = j.events.filter((e) => e.at_m <= srv.progress && e.kind !== "challenge").slice(-14).reverse()
    return ok(done.map((e, i) => ({ id: i, kind: e.kind, title: e.title, body: e.body, at_m: e.at_m, icon: e.icon, created_utc: iso(new Date(Date.now() - i * 86400e3 * 2.3)) })))
  }

  // economy
  if (p === "/me/packs") return ok({ unopened: srv.unopened, opened_count: 14, next_pack_in_m: srv.snapshot().packs.next_pack_in_m, pack_every_m: 2000 })
  if ((r = m(/^\/me\/packs\/(\d+)\/open$/))) {
    srv.unopened = srv.unopened.filter((g) => g.id !== Number(r![1]))
    return ok({ cards: [0, 1, 2, 3, 4].map((i) => ({ card: fakeCard(i + 2), is_new: i % 2 === 0, count: 1, essence_gained: 0 })), pity: {}, essence: srv.me.wallet.essence })
  }
  if (p === "/me/collection") return ok({ theme: srv.me.journey_id, owned: {}, completion: {}, essence: srv.me.wallet.essence })
  if ((r = m(/^\/themes\/(\w+)\/cards$/))) {
    const cat: CardCatalog = { theme: r[1], sets: [], cards: Array.from({ length: 12 }, (_, i) => fakeCard(i)), pack: { cards_per_pack: 5, slots: [], pity: { rare_every: 5, ultra_every: 25 } } }
    return ok(cat)
  }
  if (p === "/me/quests") return ok(srv.quests)
  if ((r = m(/^\/me\/quests\/([\w-]+)\/claim$/))) {
    const qu = srv.quests.find((x) => x.id === r![1])
    if (!qu || !qu.claimable) return err(400, "Nothing to claim")
    qu.claimable = false; qu.claimed = true
    const granted = qu.reward.packs ? Array.from({ length: qu.reward.packs }, () => ({ id: Date.now() + Math.random(), theme: srv.me.journey_id, source: "quest", source_key: qu.id, title: qu.title, created_utc: iso(new Date()), opened_utc: null })) : []
    srv.unopened.push(...granted)
    srv.me.wallet.essence += qu.reward.essence ?? 0
    srv.emit("snapshot", srv.snapshot())
    return ok({ granted, essence: qu.reward.essence ?? 0 })
  }

  // social
  if (p === "/leaderboard") return ok({ journey_id: srv.me.journey_id, period: q.get("period") ?? "week", me_rank: leaderRows((q.get("period") as any) ?? "week").find((r) => r.is_me)?.rank ?? null, total: PLAYERS.length, rows: leaderRows((q.get("period") as any) ?? "week") })
  if ((r = m(/^\/users\/(\d+)\/profile$/))) {
    const pl = PLAYERS.find((x) => x.id === Number(r![1]))
    if (!pl) return err(404, "Player not found")
    return ok({ ...pl, recent_rares: [fakeCard(5, "secret"), fakeCard(4, "ultra"), fakeCard(3, "holo"), fakeCard(2, "rare"), fakeCard(1, "uncommon")].slice(0, pl.best_rarity === "common" ? 1 : 5) })
  }
  if (p === "/live") return ok(PLAYERS.filter((x) => x.walking_now && x.id !== 1).map((profile) => ({ profile, speed_kmh: 5.1, session_distance_m: 2340 })))

  // notifications / push
  if (p === "/me/notifications") return ok(srv.notifs)
  if (p === "/me/notifications/read") {
    srv.notifs.forEach((n) => { if (!body.ids || body.ids.includes(n.id)) n.read = true })
    return ok({ ok: true })
  }
  if (p === "/me/push/vapid") return ok({ public_key: null })
  if (p === "/me/push/subscribe") { srv.me.push.subscribed = method !== "DELETE"; return ok({ ok: true }) }
  return err(404, `Mock: unknown route ${method} ${p}`)
}
