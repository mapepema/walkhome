import { BookOpen, Footprints, Home, Map, Package, ScrollText, Trophy, UserRound } from "lucide-react"
import type { Tab } from "@/lib/router"

export interface NavItem {
  tab: Tab
  label: string
  icon: typeof Home
}

export const NAV: NavItem[] = [
  { tab: "camp", label: "Camp", icon: Home },
  { tab: "walk", label: "Walk", icon: Footprints },
  { tab: "quests", label: "Quests", icon: ScrollText },
  { tab: "packs", label: "Packs", icon: Package },
  { tab: "collection", label: "Collection", icon: BookOpen },
  { tab: "race", label: "Race", icon: Trophy },
  { tab: "map", label: "Map", icon: Map },
  { tab: "profile", label: "Profile", icon: UserRound },
]

export const nav = (tab: Tab) => NAV.find((n) => n.tab === tab)!

/** Mobile bottom bar: four fixed tabs + the raised Walk button; the rest live in "More". */
export const BAR_TABS: Tab[] = ["camp", "race", "walk", "packs"]
export const MORE_TABS: Tab[] = ["quests", "collection", "map", "profile"]
