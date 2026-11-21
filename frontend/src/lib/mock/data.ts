/** Realistic fixtures for `?mock=1` (contract-shaped). Dev/screenshots only. */
import type {
  AppNotification, CardDef, Journey, LeaderRow, Me, PackGrant, PublicProfile, Quest, Rarity, SessionRow, ThemeInfo,
} from "../types"
import camino from "./data/camino.json"

export const JOURNEYS: Record<string, Journey> = {
  camino: camino as unknown as Journey,
}

export const THEMES: ThemeInfo[] = Object.values(JOURNEYS).map((j) => ({
  id: j.id,
  name: j.name,
  subtitle: j.subtitle,
  lang: j.lang,
  total_m: j.total_m,
  card_count: 72,
  palette: j.biomes[10].palette,
  biome_names: j.biomes.slice(0, 4).map((b) => b.name),
}))

export const iso = (d: Date) => d.toISOString()
export const daysAgo = (n: number, hour = 18) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 10, 0, 0)
  return d
}

export const ME: Me = {
  id: 1,
  username: "alex",
  display_name: "Alex",
  avatar: "🧙",
  color: "#e3b45c",
  journey_id: "camino",
  is_admin: true,
  handicap: 1,
  daily_goal_m: 3000,
  units: "km",
  created_utc: iso(daysAgo(80)),
  wallet: { essence: 185 },
  unopened_packs: 2,
  push: { supported: true, subscribed: false },
}

const P = (id: number, name: string, avatar: string, color: string, km: number, streak: number, extra: Partial<PublicProfile> = {}): PublicProfile => ({
  id, username: name.toLowerCase(), display_name: name, avatar, color,
  journey_id: "camino", progress_m: km * 1000, fraction: (km * 1000) / 780000,
  stage_name: "Saint-Jean-Pied-de-Port to Burgos", biome_name: "the wheat of Burgos", streak_days: streak,
  cards_owned: 20 + id * 6, cards_total: 72, walking_now: false, best_rarity: "rare", ...extra,
})

export const PLAYERS: PublicProfile[] = [
  P(2, "Riley", "🦊", "#f472b6", 612, 21, { best_rarity: "secret", cards_owned: 58, biome_name: "the climb to O Cebreiro" }),
  P(3, "Sam", "🐻", "#60a5fa", 540, 9, { best_rarity: "ultra", walking_now: true }),
  P(4, "Jordan", "🦉", "#a78bfa", 498, 14, { best_rarity: "holo" }),
  P(1, "Alex", "🧙", "#e3b45c", 214, 6, { best_rarity: "holo", cards_owned: 34 }),
  P(5, "Morgan", "🐺", "#34d399", 187, 3, { best_rarity: "rare" }),
  P(6, "Casey", "🦋", "#fb923c", 142, 0, { best_rarity: "uncommon" }),
  P(7, "Quinn", "🐉", "#f87171", 96, 2, { best_rarity: "rare" }),
  P(8, "Taylor", "🌻", "#facc15", 51, 1, { best_rarity: "common" }),
]

const WEEK: Record<number, number> = { 2: 38400, 3: 31200, 4: 22800, 1: 20900, 5: 14100, 6: 9400, 7: 4300, 8: 1200 }
const MONTH_MULT = 3.4
const ALL_FROM_PROGRESS = true

export function leaderRows(period: "week" | "month" | "all"): LeaderRow[] {
  const val = (p: PublicProfile) =>
    period === "week" ? WEEK[p.id] : period === "month" ? Math.round(WEEK[p.id] * MONTH_MULT) : ALL_FROM_PROGRESS ? p.progress_m : 0
  const sorted = [...PLAYERS].sort((a, b) => val(b) - val(a))
  return sorted.map((p, i) => ({
    rank: i + 1,
    profile: p,
    distance_m: val(p),
    delta_rank: [0, 1, -1, 2, 0, -2, 0, 1][i] ?? 0,
    is_me: p.id === 1,
    gap_to_next_m: i === 0 ? null : val(sorted[i - 1]) - val(p),
  }))
}

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "holo", "ultra", "secret"]
const SAMPLE_CARDS: [string, string, string, string, string][] = [
  ["em", "emberling", "Emberling", "Creature", "Ember Beast"],
  ["em", "emberfox", "Ember Fox", "Creature", "Ember Beast"],
  ["em", "coalraven", "Coal Raven", "Creature", "Ember Beast"],
  ["em", "lavastag", "Lava Stag", "Creature", "Ember Beast"],
  ["em", "dawnhammer", "Dawn Hammer", "Relic", "Forge Work"],
  ["em", "ashphoenix", "Ash Phoenix", "Creature", "Ember Beast"],
  ["pk", "starsanctuary", "Star Sanctuary", "Place", "High Country"],
  ["pk", "conjunction", "Conjunction", "Phenomenon", "Summit Sky"],
]
export function fakeCard(i: number, rarity: Rarity = RARITIES[i % 6]): CardDef {
  const [set, slug, name, type, subtitle] = SAMPLE_CARDS[i % SAMPLE_CARDS.length]
  return {
    id: `camino:${set}:${slug}`, theme: "camino", set, number: i + 1, name,
    subtitle, type, rarity, foil: rarity === "holo" ? "rainbow" : rarity === "ultra" ? "cosmos" : "none",
    image: `/cards/embers-peaks/${set}/${slug}.webp`, thumb: `/cards/embers-peaks/${set}/${slug}.thumb.webp`,
    flavor: "Every long road starts with a single step.",
  }
}

export function grants(n: number, source = "distance"): PackGrant[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 100 + i + Math.floor(Math.random() * 1000), theme: "camino", source, source_key: String(Math.random()),
    title: source === "daily" ? "First steps of the day" : source === "quest" ? "Quest complete" : "Distance pack",
    created_utc: iso(new Date()), opened_utc: null,
  }))
}

export function makeSessions(): SessionRow[] {
  const rows: SessionRow[] = []
  let id = 400
  for (let d = 0; d < 300; d++) {
    const dow = daysAgo(d).getDay()
    const seed = (d * 7919) % 11
    if (seed < 3 && d > 6) continue // rest days
    const n = seed > 8 ? 2 : 1
    for (let k = 0; k < n; k++) {
      const km = 1.6 + ((seed * 0.43 + k * 1.1 + (dow === 6 ? 2.4 : 0)) % 4.8)
      const speed = 4.2 + ((seed + k) % 5) * 0.28
      const mins = (km / speed) * 60
      const start = daysAgo(d, 7 + k * 11)
      rows.push({
        id: id--, user_id: 1, journey_id: "camino", source: seed === 5 && k === 0 ? "manual" : "treadmill", state: "ended",
        start_utc: iso(start), end_utc: iso(new Date(start.getTime() + mins * 60000)),
        distance_m: Math.round(km * 1000), elapsed_s: Math.round(mins * 60), moving_s: Math.round(mins * 60 * 0.97),
        note: d === 2 ? "Podcast, rain outside" : d === 9 ? "Long session" : null,
        avg_hr_bpm: 108 + (seed * 3), max_speed_kmh: speed + 0.8,
      })
    }
  }
  return rows
}

export function makeQuests(): Quest[] {
  const exp = (h: number) => iso(new Date(Date.now() + h * 3600e3))
  return [
    { id: "d_walk2k", period: "daily", icon: "👣", title: "Walk 2 km", description: "Cover 2 km today, on the treadmill or outdoors.", target: 2000, progress: 2000, unit: "m", reward: { packs: 1 }, claimable: true, claimed: false, expires_utc: exp(7) },
    { id: "d_pace", period: "daily", icon: "⚡", title: "Steady pace", description: "Hold 5 km/h or faster for 10 minutes.", target: 600, progress: 360, unit: "s", reward: { essence: 30 }, claimable: false, claimed: false, expires_utc: exp(7) },
    { id: "d_challenge", period: "daily", icon: "⚔️", title: "Take on a challenge", description: "Complete a challenge on the road.", target: 1, progress: 0, unit: "count", reward: { essence: 20 }, claimable: false, claimed: false, expires_utc: exp(7) },
    { id: "w_3x5", period: "weekly", icon: "🔥", title: "5 km, three days", description: "Walk 5 km or more on three days this week.", target: 3, progress: 2, unit: "days", reward: { packs: 2 }, claimable: false, claimed: false, expires_utc: exp(96) },
    { id: "w_15k", period: "weekly", icon: "🏔️", title: "15 km this week", description: "Walk 15 km in total.", target: 15000, progress: 11200, unit: "m", reward: { packs: 1, essence: 50 }, claimable: false, claimed: false, expires_utc: exp(96) },
    { id: "w_open5", period: "weekly", icon: "🎴", title: "Open 5 packs", description: "Discover new cards.", target: 5, progress: 5, unit: "count", reward: { essence: 80 }, claimable: false, claimed: true, expires_utc: exp(96) },
    { id: "s_next", period: "story", icon: "🏰", title: "Reach the next milestone", description: "Follow the road to the next camp.", target: 1, progress: 0, unit: "count", reward: { packs: 2 }, claimable: false, claimed: false, expires_utc: null },
  ]
}

export function makeNotifs(): AppNotification[] {
  const ago = (min: number) => iso(new Date(Date.now() - min * 60000))
  return [
    { id: 9, kind: "rank_overtake", title: "Morgan overtook you!", body: "You drop to 5th. Only 1.2 km to win your place back.", icon: "🏃", created_utc: ago(12), read: false, data: { url: "#/race" } },
    { id: 8, kind: "pack", title: "Pack earned", body: "You walked 2 km: a pack is waiting for you.", icon: "🎴", created_utc: ago(95), read: false, data: { url: "#/packs" } },
    { id: 7, kind: "quest", title: "Quest ready", body: "\u201cWalk 2 km\u201d can be claimed.", icon: "📜", created_utc: ago(190), read: false },
    { id: 6, kind: "milestone", title: "Milestone reached", body: "You reached Pamplona. The road goes on to Puente la Reina.", icon: "🏰", created_utc: ago(60 * 26), read: true },
    { id: 5, kind: "streak_risk", title: "Your streak is at risk", body: "6 days in a row: walk a little before midnight to keep it.", icon: "🔥", created_utc: ago(60 * 30), read: true },
    { id: 4, kind: "weekly_podium", title: "Weekly podium", body: "You finished 3rd last week: 1 pack awarded.", icon: "🏆", created_utc: ago(60 * 24 * 4), read: true },
    { id: 3, kind: "system", title: "Welcome", body: "Your account is ready. 2 packs are waiting for you.", icon: "✨", created_utc: ago(60 * 24 * 80), read: true },
  ]
}
