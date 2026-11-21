/** TCG module types, matching CONTRACT.md sections 3, 4 and 7. */

export type Rarity = "common" | "uncommon" | "rare" | "holo" | "ultra" | "secret"
export type Foil = "none" | "linear" | "cosmos" | "rainbow" | "reverse"

export interface CardDef {
  /** "<theme>:<set>:<slug>" */
  id: string
  theme: string
  set: string
  number: number
  name: string
  subtitle?: string
  type?: string
  rarity: Rarity
  foil: Foil
  /** Full card albedo (~480x672). */
  image: string
  /** Thumbnail (~240x336). */
  thumb: string
  /** Normalised x, y, w, h (0..1) of the artwork area (holo mask). */
  art_rect?: [number, number, number, number]
  flavor?: string
  artist?: string
  stats?: Record<string, number | string>
}

export interface CardSetDef {
  id: string
  theme: string
  name: string
  card_count: number
  /** Pack wrapper colour. */
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

export interface PackGrant {
  id: number
  theme: string
  source: string
  source_key: string
  title: string
  created_utc: string
  opened_utc: string | null
}

export interface PacksResponse {
  unopened: PackGrant[]
  opened_count: number
  next_pack_in_m: number
  pack_every_m: number
}

export interface OpenedCard {
  card: CardDef
  is_new: boolean
  count: number
  essence_gained: number
}

export interface OpenResult {
  pack_id?: number
  theme?: string
  /** Album packs unlocked by this opening. */
  granted?: PackGrant[]
  cards: OpenedCard[]
  pity?: Record<string, unknown>
  essence: number
}

export interface CollectionResponse {
  theme: string
  owned: Record<string, { count: number; first_utc: string }>
  completion: Record<string, { owned: number; total: number }>
  essence: number
}

/** GET /me/economy: shape not fixed by the contract, read tolerantly. */
export interface EconomyResponse {
  craft_cost?: Partial<Record<Rarity, number>>
  craft?: Partial<Record<Rarity, number>>
  dup_essence?: Partial<Record<Rarity, number>>
  essence?: Partial<Record<Rarity, number>>
  dust?: Partial<Record<Rarity, number>>
  [k: string]: unknown
}

export type CardSize = "xs" | "sm" | "md" | "lg"
