/**
 * Quality profile. Foil is mostly fragment-bound: lower the DPR first,
 * then texture resolution and particles, never the shader itself.
 */
export type QualityTier = "high" | "medium" | "low"

export interface QualityProfile {
  tier: QualityTier
  dpr: [number, number]
  /** Size of the mask / normal maps (px wide). */
  maskWidth: number
  particles: number
  postprocessing: boolean
  reducedMotion: boolean
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

let cached: QualityProfile | null = null

export function detectQuality(force = false): QualityProfile {
  if (cached && !force) return cached
  const reducedMotion = prefersReducedMotion()
  let p: QualityProfile
  if (typeof window === "undefined") {
    p = { tier: "medium", dpr: [1, 1.5], maskWidth: 256, particles: 40, postprocessing: false, reducedMotion }
  } else {
    const q = new URLSearchParams(location.search).get("quality")
    const nav = navigator as Navigator & { deviceMemory?: number }
    const cores = nav.hardwareConcurrency ?? 4
    const memory = nav.deviceMemory ?? 4
    const coarse = window.matchMedia("(pointer: coarse)").matches
    const small = Math.min(window.innerWidth, window.innerHeight) < 500
    let tier: QualityTier = cores <= 4 || memory <= 3 ? "low" : coarse || small ? "medium" : "high"
    if (q === "low" || q === "medium" || q === "high") tier = q
    p =
      tier === "low"
        ? { tier, dpr: [1, 1.25], maskWidth: 192, particles: 0, postprocessing: false, reducedMotion }
        : tier === "medium"
          ? { tier, dpr: [1, 2], maskWidth: 256, particles: 36, postprocessing: false, reducedMotion }
          : { tier, dpr: [1, 2], maskWidth: 384, particles: 80, postprocessing: false, reducedMotion }
    if (reducedMotion) p.particles = 0
  }
  cached = p
  return p
}
