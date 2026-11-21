/** Journey-driven theming: the active biome's palette becomes CSS tokens on
 * <html>. The tokens are registered with @property (index.css) so changing
 * biome cross-fades colours instead of snapping. */
import type { Palette } from "./types"

export const DEFAULT_ACCENT = "#e3b45c"

function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "")
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m
  const r = parseInt(n.slice(0, 2), 16) / 255
  const g = parseInt(n.slice(2, 4), 16) / 255
  const b = parseInt(n.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%${a < 1 ? ` / ${a}` : ""})`

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export interface ThemeTokens {
  accent: string
  accent2: string
  glow: string
  bg: string
  bg2: string
  skyA: string
  skyB: string
  accentFg: string
  accentHex: string
}

export function deriveTokens(p: Palette | null | undefined, accentHint?: string): ThemeTokens {
  const base = accentHint ?? p?.accent ?? DEFAULT_ACCENT
  const [h, s0, l0] = hexToHsl(base)
  const s = clamp(s0, 0.4, 0.62)
  const l = clamp(l0, 0.62, 0.72)
  const [gh, gs] = hexToHsl(p?.ground ?? "#2a2a2a")
  const bgH = p ? gh : 36
  const bgS = p ? clamp(gs, 0.06, 0.16) : 0.08
  return {
    accent: hsl(h, s, l),
    accent2: hsl(h, s, clamp(l - 0.15, 0.4, 0.55)),
    glow: hsl(h, s, l, 0.35),
    bg: hsl(bgH, bgS, 0.045),
    bg2: hsl(bgH, bgS, 0.075),
    skyA: p?.sky[0] ?? "#8fd3f4",
    skyB: p?.sky[1] ?? "#d9f0ff",
    accentFg: hsl(h, 0.5, 0.1),
    accentHex: base,
  }
}

export function applyTheme(p: Palette | null | undefined, journeyId?: string, accentHint?: string) {
  const t = deriveTokens(p, accentHint)
  const root = document.documentElement
  root.style.setProperty("--th-accent", t.accent)
  root.style.setProperty("--th-accent-2", t.accent2)
  root.style.setProperty("--th-glow", t.glow)
  root.style.setProperty("--th-bg", t.bg)
  root.style.setProperty("--th-bg-2", t.bg2)
  root.style.setProperty("--th-sky-a", t.skyA)
  root.style.setProperty("--th-sky-b", t.skyB)
  root.style.setProperty("--th-accent-fg", t.accentFg)
  root.dataset.theme = journeyId ?? ""
  // theme-colour meta follows the biome (PWA chrome / status bar)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", t.bg)
  return t
}

/** Journeys that ship an inscription-style display face. */
export function displayFont(journeyId?: string | null): "cinzel" | "serif" {
  return journeyId === "camino" ? "cinzel" : "serif"
}

/** Preview palette for a theme whose `/api/themes` entry carries none: a stable
 * hue derived from the id so two themes never look identical. */
export function fallbackPalette(id: string): Palette {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  const c = (s: number, l: number, dh = 0) => {
    const hh = (((h + dh) % 360) + 360) % 360
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => {
      const k = (n + hh / 30) % 12
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
      return Math.round(v * 255).toString(16).padStart(2, "0")
    }
    return `#${f(0)}${f(8)}${f(4)}`
  }
  return { sky: [c(0.5, 0.55), c(0.55, 0.78, 12)], sun: c(0.7, 0.88, 20), far: c(0.3, 0.5), mid: c(0.3, 0.38), near: c(0.3, 0.24), ground: c(0.3, 0.14), accent: c(0.7, 0.65, 10), fog: c(0.3, 0.8) }
}
