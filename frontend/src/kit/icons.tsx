import {
  Award, Bell, Compass, Crown, Flag, Flame, Footprints, Gauge, Gift, Layers, Leaf, Map as MapIcon, Medal, Moon, Mountain,
  Rocket, ScrollText, Shield, Sparkles, Star, Sun, Swords, Target, Trees, Trophy, UserRound, Waves, Wind, Zap,
  type LucideIcon,
} from "lucide-react"
import type { AppNotification, JourneyEvent, Quest } from "@/lib/types"

/** Avatars are icon ids (legacy emoji avatars map to a stable icon). */
export const AVATAR_ICONS: Record<string, LucideIcon> = {
  mountain: Mountain, compass: Compass, flame: Flame, leaf: Leaf, moon: Moon, sun: Sun, star: Star, shield: Shield,
  wind: Wind, waves: Waves, trees: Trees, rocket: Rocket,
}
export const AVATAR_IDS = Object.keys(AVATAR_ICONS)

export function avatarIcon(id: string | undefined): LucideIcon {
  if (!id) return UserRound
  if (AVATAR_ICONS[id]) return AVATAR_ICONS[id]
  let h = 0
  for (const c of id) h = (h * 31 + c.codePointAt(0)!) % 997
  return AVATAR_ICONS[AVATAR_IDS[h % AVATAR_IDS.length]]
}

export function QuestGlyph({ q, className }: { q: Pick<Quest, "id" | "period">; className?: string }) {
  const id = q.id
  const I = /pace/.test(id) ? Gauge : /challenge/.test(id) ? Swords : /open/.test(id) ? Layers : /milestone|story/.test(id) || q.period === "story" ? Flag : /15km|km_x|5km/.test(id) ? Mountain : Footprints
  return <I className={className} strokeWidth={1.8} />
}

export function NotifGlyph({ kind, className }: { kind: AppNotification["kind"]; className?: string }) {
  const I = { pack: Gift, rank_overtake: Trophy, weekly_podium: Medal, streak_risk: Flame, quest: ScrollText, milestone: Flag, system: Sparkles }[kind] ?? Bell
  return <I className={className} strokeWidth={1.8} />
}

export function EventGlyph({ kind, className }: { kind: JourneyEvent["kind"] | string; className?: string }) {
  const I = kind === "milestone" ? Flag : kind === "challenge" ? Zap : kind === "choice" ? Compass : MapIcon
  return <I className={className} strokeWidth={1.8} />
}

export { Award, Crown, Target, Sparkles }
