import type { Rarity, EconomyResponse } from "./types"

export interface RarityMeta {
  id: Rarity
  label: string
  /** Accent colour (UI, halo, border). */
  color: string
  /** Secondary colour for gradients. */
  color2: string
  rank: number
  /** Essence earned for a duplicate (contract section 3). */
  essence: number
}

export const RARITIES: Record<Rarity, RarityMeta> = {
  common: { id: "common", label: "Common", color: "#a8b0be", color2: "#6f7787", rank: 0, essence: 5 },
  uncommon: { id: "uncommon", label: "Uncommon", color: "#5fd1a0", color2: "#2e8f6c", rank: 1, essence: 10 },
  rare: { id: "rare", label: "Rare", color: "#6fb0ff", color2: "#3a6fc4", rank: 2, essence: 25 },
  holo: { id: "holo", label: "Holo", color: "#b79cff", color2: "#6d4fd8", rank: 3, essence: 60 },
  ultra: { id: "ultra", label: "Ultra rare", color: "#ff9be6", color2: "#c24fb0", rank: 4, essence: 150 },
  secret: { id: "secret", label: "Secret", color: "#ffd56b", color2: "#d9902a", rank: 5, essence: 400 },
}

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "holo", "ultra", "secret"]

export const rarityMeta = (r: Rarity): RarityMeta => RARITIES[r] ?? RARITIES.common

/** Craft cost of a card (contract: 4 × duplicate essence, unless /economy says otherwise). */
export function craftCost(r: Rarity, eco: EconomyResponse | null): number | null {
  if (r === "secret") return null
  const fromApi = eco?.craft_cost?.[r] ?? eco?.craft?.[r]
  if (typeof fromApi === "number") return fromApi
  return RARITIES[r].essence * 4
}
