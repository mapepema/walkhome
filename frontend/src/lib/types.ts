/** Mirror of the backend's JSON shapes (app/service.py snapshots). */

export interface Palette {
  sky: string[]
  sun: string
  far: string
  mid: string
  near: string
  ground: string
  accent: string
  fog: string
}

export interface Biome {
  id: string
  name: string
  terrain: string
  weather: "clear" | "fog" | "rain" | "snow" | "wind" | "ash" | "dark"
  night?: boolean
  start_m: number
  end_m: number
  palette: Palette
}

export interface Stage {
  id: string
  name: string
  start_m: number
  end_m: number
}

export interface ChoiceOption {
  id: string
  label: string
  detail?: string
  outcome?: string
}

export interface JourneyEvent {
  id: string
  at_m: number
  kind: "beat" | "milestone" | "challenge" | "choice"
  title: string
  body: string
  icon: string
  approx?: boolean
  challenge?: Record<string, unknown>
  choice?: { options: ChoiceOption[] }
}

export interface Journey {
  id: string
  lang: string
  name: string
  subtitle: string
  total_m: number
  total_mi: number
  source_note: string
  stages: Stage[]
  biomes: Biome[]
  events: JourneyEvent[]
  map: {
    view_box: string
    path: string
    decor: { kind: string; x: number; y: number; text: string }[]
  }
}

export interface Subject {
  kind: "user"
  id: number
  journey_id: string
  progress_m: number
  fraction: number
  remaining_m: number
  biome: Biome | null
  stage: Stage | null
  last_event: JourneyEvent | null
  next_milestone: JourneyEvent | null
  next_milestone_in_m: number | null
  finished: boolean
  pace_m_per_day?: number
  eta_days_to_milestone?: number
  eta_days_to_finish?: number
  // user extras
  display_name?: string
  avatar?: string
  color?: string
  handicap?: number
  daily_goal_m?: number
}

export interface Telemetry {
  distance_m: number
  integrated_m: number
  device_m: number | null
  drift_m: number | null
  elapsed_s: number
  moving_s: number
  speed_kmh: number
  max_speed_kmh: number
  avg_hr_bpm: number | null
  samples: number
  resets_seen: number
  gaps_seen: number
}

export interface ChallengeSnap {
  event_id: string
  title: string
  icon: string
  kind: string
  state: "running" | "succeeded" | "failed"
  target: string
  note: string
  fallback_used: boolean
  duration_s: number
  held_s: number
  progress: number
  remaining_s: number
  min_speed_kmh: number | null
  min_incline_pct: number | null
}

export interface PendingChoice {
  event_id: string
  title: string
  body: string
  options: ChoiceOption[]
}

export interface SessionSnap {
  id: number
  user: { id: number; display_name: string; avatar: string; color: string; handicap: number }
  journey_id: string
  state: "idle" | "active" | "paused" | "no_link" | "ended"
  manual_pause: boolean
  started_at: string
  telemetry: Telemetry
  incline_pct: number | null
  heart_rate_bpm: number | null
  progress_m: number
  fraction: number
  biome: Biome | null
  stage: Stage | null
  next_milestone: JourneyEvent | null
  challenge: ChallengeSnap | null
  pending_choice: PendingChoice | null
}

export interface SessionRow {
  id: number
  user_id: number
  journey_id: string
  source: string
  state: string
  start_utc: string
  end_utc: string | null
  distance_m: number
  elapsed_s: number
  moving_s: number
  note: string | null
  avg_hr_bpm?: number | null
  max_speed_kmh?: number | null
}

export interface JournalEntry {
  id: number
  kind: string
  title: string
  body: string
  at_m: number
  icon: string | null
  created_utc: string
}

/* ---------------------------------------------------------------- v2 ---- */

export type Units = "km" | "mi"

export interface Me {
  id: number
  username: string
  display_name: string
  avatar: string
  color: string
  journey_id: string
  is_admin: boolean
  handicap: number
  daily_goal_m: number
  units: Units
  created_utc: string
  wallet: { essence: number }
  unopened_packs: number
  push: { supported: boolean; subscribed: boolean }
}

export type Rarity = "common" | "uncommon" | "rare" | "holo" | "ultra" | "secret"
export type Foil = "none" | "linear" | "cosmos" | "rainbow" | "reverse"

export interface CardDef {
  id: string
  theme: string
  set: string
  number: number
  name: string
  subtitle?: string
  type?: string
  rarity: Rarity
  foil: Foil
  image: string
  thumb: string
  art_rect?: [number, number, number, number]
  flavor?: string
  artist?: string
  stats?: Record<string, number | string>
}

export interface PackGrant {
  id: number
  theme: string
  source: string
  source_key: string
  title: string
  created_utc: string
  opened_utc: string | null
}

export interface PublicProfile {
  id: number
  username: string
  display_name: string
  avatar: string
  color: string
  journey_id: string
  progress_m: number
  fraction: number
  stage_name: string | null
  biome_name: string | null
  streak_days: number
  cards_owned: number
  cards_total: number
  walking_now: boolean
  best_rarity: Rarity | null
}

export interface PublicProfileFull extends PublicProfile {
  recent_rares: CardDef[]
}

export interface SnapshotLink {
  state: "live" | "stale" | "disconnected"
  detail: string
  source: string
}

export interface Snapshot {
  me: Me
  journey_id: string
  units: Units
  link: SnapshotLink
  treadmill: { busy: boolean; walker: PublicProfile | null }
  session: SessionSnap | null
  subject: Subject
  packs: { unopened: number; next_pack_in_m: number; pack_every_m: number }
  rank: { week: number | null; all: number | null; total: number }
  unread_notifications: number
}

export interface Quest {
  id: string
  period: "daily" | "weekly" | "story"
  icon: string
  title: string
  description: string
  target: number
  progress: number
  unit: "m" | "count" | "days" | "s"
  reward: { packs?: number; essence?: number }
  claimable: boolean
  claimed: boolean
  expires_utc: string | null
}

export interface LeaderRow {
  rank: number
  profile: PublicProfile
  distance_m: number
  delta_rank: number
  is_me: boolean
  gap_to_next_m: number | null
}

export interface Leaderboard {
  journey_id: string
  period: string
  me_rank: number | null
  total: number
  rows: LeaderRow[]
}

export type Period = "week" | "month" | "all"

export interface LiveWalker {
  profile: PublicProfile
  speed_kmh: number
  session_distance_m: number
}

export interface PresenceWalker {
  user_id: number
  display_name: string
  avatar: string
  color: string
  speed_kmh: number
}

export interface AppNotification {
  id: number
  kind: "pack" | "rank_overtake" | "weekly_podium" | "streak_risk" | "quest" | "milestone" | "system"
  title: string
  body: string
  icon: string
  created_utc: string
  read: boolean
  data?: Record<string, unknown>
}

export interface RankEvent {
  journey_id: string
  rank: number
  previous_rank: number
  overtaken_by?: PublicProfile
  overtook?: PublicProfile
}

export interface RewardEvent {
  grants: PackGrant[]
  reason: string
  title: string
}

export interface DailyRow {
  day: string
  distance_m: number
  sessions: number
}

export interface Streak {
  days: number
  grace_used: number
  last_walk: string | null
  best?: number
}

export interface PacksInfo {
  unopened: PackGrant[]
  opened_count: number
  next_pack_in_m: number
  pack_every_m: number
}

export interface ThemeInfo {
  id: string
  name: string
  subtitle: string
  lang?: string
  total_m: number
  card_count: number
  palette?: Palette
  accent?: string
  biome_names?: string[]
}

export interface ChallengeResult {
  title: string
  icon: string
  succeeded: boolean
  text: string
  held_s: number
}

export interface CardSetDef {
  id: string
  theme: string
  name: string
  card_count: number
  accent: string
  cover?: string
}

export interface CardCatalog {
  theme: string
  sets: CardSetDef[]
  cards: CardDef[]
  pack: {
    cards_per_pack: number
    slots: { label: string; odds: Partial<Record<Rarity, number>> }[]
    pity: { rare_every: number; ultra_every: number }
  }
}
