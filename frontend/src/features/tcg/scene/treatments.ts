import type { CardDef, Foil, Rarity } from "../types"

/** Foil parameters (shader uniforms). */
export interface FoilParams {
  hue: number
  tiltShift: number
  milkiness: number
  saturation: number
  warp: number
  lineFrequency: number
  lineAngle: number
  glint: number
  sparkle: number
  sparkleDensity: number
  sparkleSize: number
  brightness: number
  glare: number
  parallax: number
  borderGlint: number
  borderHue: number
}

/** Substrate parameters (paper/varnish/PBR). */
export interface SubstrateParams {
  holoAmount: number
  borderAmount: number
  metalness: number
  roughness: number
  iridescence: number
  iridescenceIOR: number
  thicknessMin: number
  thicknessMax: number
  normalStrength: number
  grain: number
  foilEtch: number
  clearcoat: number
  clearcoatRoughness: number
}

export interface Treatment {
  foil: FoilParams
  substrate: SubstrateParams
  /** Spectrum name (see spectra). */
  spectrum: "pastel" | "cosmos" | "rainbow" | "gold"
  /** Scene effects (halo, particles). 0..1 */
  aura: number
  /** Floating particles (0 = none). */
  particles: number
}

export const BASE_FOIL: FoilParams = {
  hue: 0.85,
  tiltShift: 1.2,
  milkiness: 0.2,
  saturation: 0.8,
  warp: 4.0,
  lineFrequency: 22,
  lineAngle: 1.2,
  glint: 0.14,
  sparkle: 0.8,
  sparkleDensity: 170,
  sparkleSize: 0.13,
  brightness: 1.0,
  glare: 0,
  parallax: 1,
  borderGlint: 0,
  borderHue: 1.2,
}

export const BASE_SUBSTRATE: SubstrateParams = {
  holoAmount: 1,
  borderAmount: 0,
  metalness: 0.28,
  roughness: 0.32,
  iridescence: 0,
  iridescenceIOR: 1.3,
  thicknessMin: 100,
  thicknessMax: 400,
  normalStrength: 0.1,
  grain: 0.06,
  foilEtch: 0.035,
  clearcoat: 0.35,
  clearcoatRoughness: 0.25,
}

/**
 * How to add a foil: add an entry here (FOIL_BY_KIND), optionally a
 * spectrum (spectra.ts), and reference it from `Foil` (types.ts) + `RARITY_BOOST`.
 */
export const FOIL_BY_KIND: Record<Foil, { foil: Partial<FoilParams>; substrate: Partial<SubstrateParams>; spectrum: Treatment["spectrum"] }> = {
  none: {
    foil: { glint: 0, sparkle: 0, glare: 0 },
    substrate: { holoAmount: 0, metalness: 0, roughness: 0.78, normalStrength: 0.1, grain: 0.04, clearcoat: 0.12 },
    spectrum: "pastel",
  },
  linear: {
    foil: { hue: 0.7, lineFrequency: 26, glint: 0.2, sparkle: 0.35, milkiness: 0.24, glare: 0.22 },
    substrate: { metalness: 0.3, roughness: 0.28, iridescence: 0.1, thicknessMax: 380 },
    spectrum: "pastel",
  },
  cosmos: {
    foil: { hue: 1.1, lineFrequency: 6, glint: 0.16, sparkle: 1.3, sparkleDensity: 280, sparkleSize: 0.16, warp: 6, glare: 0.26, parallax: 1.6 },
    substrate: { metalness: 0.3, roughness: 0.34, iridescence: 0.18, thicknessMin: 180, thicknessMax: 520 },
    spectrum: "cosmos",
  },
  rainbow: {
    foil: { hue: 1.6, saturation: 1.0, milkiness: 0.06, glint: 0.3, sparkle: 0.95, brightness: 1.1, glare: 0.34, parallax: 1.3 },
    substrate: { metalness: 0.34, roughness: 0.24, iridescence: 0.22, iridescenceIOR: 1.45, thicknessMax: 620 },
    spectrum: "rainbow",
  },
  reverse: {
    foil: { hue: 0.6, lineFrequency: 14, glint: 0.22, sparkle: 0.6, milkiness: 0.3, glare: 0.2 },
    substrate: { metalness: 0.3, roughness: 0.36, iridescence: 0.1 },
    spectrum: "pastel",
  },
}

/** Per-rarity fine tuning (multipliers/additions on top of the base foil). */
export const RARITY_BOOST: Record<Rarity, { foil: Partial<FoilParams>; substrate: Partial<SubstrateParams>; aura: number; particles: number; spectrum?: Treatment["spectrum"] }> = {
  common: { foil: {}, substrate: {}, aura: 0, particles: 0 },
  uncommon: { foil: { glint: 0.1, glare: 0.12 }, substrate: { borderAmount: 0 }, aura: 0, particles: 0 },
  rare: {
    foil: { glare: 0.26, borderGlint: 0.4, borderHue: 1.0 },
    substrate: { borderAmount: 0.55, clearcoat: 0.55 },
    aura: 0.15,
    particles: 0,
  },
  holo: {
    foil: { glint: 0.2, glare: 0.34, borderGlint: 0.65, borderHue: 1.4, sparkle: 1.0 },
    substrate: { borderAmount: 0.85, clearcoat: 0.8, clearcoatRoughness: 0.12 },
    aura: 0.4,
    particles: 0,
  },
  ultra: {
    foil: { glint: 0.2, glare: 0.42, borderGlint: 0.8, borderHue: 2.0, sparkle: 1.1, brightness: 1.05, parallax: 1.8 },
    substrate: { borderAmount: 1, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0.22, roughness: 0.2 },
    aura: 0.75,
    particles: 28,
  },
  secret: {
    foil: { glint: 0.26, glare: 0.5, borderGlint: 1.0, borderHue: 2.6, sparkle: 1.3, brightness: 1.08, saturation: 1, parallax: 2.2 },
    substrate: { borderAmount: 1, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.3, iridescenceIOR: 1.6, roughness: 0.16, thicknessMax: 700 },
    aura: 1,
    particles: 56,
    spectrum: "gold",
  },
}

export function resolveTreatment(card: Pick<CardDef, "foil" | "rarity">): Treatment {
  const kind = FOIL_BY_KIND[card.foil] ?? FOIL_BY_KIND.none
  const boost = RARITY_BOOST[card.rarity] ?? RARITY_BOOST.common
  // A card without foil stays understated whatever its rarity (except a varnish glint).
  const hasFoil = card.foil !== "none"
  return {
    foil: { ...BASE_FOIL, ...kind.foil, ...(hasFoil ? boost.foil : { glare: boost.foil.glare ? boost.foil.glare * 0.3 : 0 }) },
    substrate: {
      ...BASE_SUBSTRATE,
      ...kind.substrate,
      ...boost.substrate,
      ...(hasFoil ? {} : { holoAmount: 0, metalness: 0, iridescence: 0, borderAmount: boost.substrate.borderAmount ?? 0 }),
    },
    spectrum: boost.spectrum && card.rarity === "secret" ? (card.foil === "rainbow" ? "rainbow" : "gold") : kind.spectrum,
    aura: boost.aura,
    particles: boost.particles,
  }
}
