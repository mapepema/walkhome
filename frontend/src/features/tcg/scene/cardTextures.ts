import * as THREE from "three"
import type { CardDef } from "../types"
import { detectQuality } from "../lib/quality"
import { rarityMeta } from "../rarity"

/**
 * Card textures: albedo (full image), holo mask (derived from art_rect +
 * foil/rarity) and normal map (Sobel on luminance). Everything is computed on canvas,
 * cached per card, with reference counting and LRU eviction (a phone's VRAM
 * cannot hold 1,700 cards).
 */
export interface CardTextures {
  map: THREE.Texture
  mask: THREE.Texture
  normal: THREE.Texture
  dispose: () => void
}

const DEFAULT_ART: [number, number, number, number] = [0.1, 0.1, 0.8, 0.5]
const CARD_ASPECT = 672 / 480

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.decoding = "async"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`image not found: ${url}`))
    img.src = url
  })
}

/** Fallback card when the image is missing (assets not generated yet). */
function placeholder(card: CardDef): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = 480
  c.height = 672
  const ctx = c.getContext("2d")!
  const m = rarityMeta(card.rarity)
  const g = ctx.createLinearGradient(0, 0, 480, 672)
  g.addColorStop(0, "#161a26")
  g.addColorStop(1, "#0b0d14")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 480, 672)
  ctx.strokeStyle = m.color
  ctx.lineWidth = 8
  ctx.strokeRect(14, 14, 452, 644)
  ctx.fillStyle = "rgba(255,255,255,.06)"
  const a = card.art_rect ?? DEFAULT_ART
  ctx.fillRect(a[0] * 480, a[1] * 672, a[2] * 480, a[3] * 672)
  ctx.fillStyle = "#efe3c8"
  ctx.textAlign = "center"
  ctx.font = '700 34px Cinzel, serif'
  ctx.fillText(card.name, 240, 56, 420)
  return c
}

function sdRoundRect(px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Holo mask: R = artwork foil, G = frame band (card border + artwork outline).
 * Foil/rarity variants change the distribution (reverse = everything but the art,
 * rainbow/ultra/secret = art + full-frame veil).
 */
export function buildMasks(card: CardDef, W: number, H: number, lum: Float32Array) {
  const [ax, ay, aw, ah] = card.art_rect ?? DEFAULT_ART
  const cx = (ax + aw / 2) * W
  const cy = (ay + ah / 2) * H
  const hw = (aw / 2) * W
  const hh = (ah / 2) * H
  const rr = 0.018 * W
  const f = 0.014 * W
  const cardR = 0.05 * W
  const full = card.rarity === "ultra" ? 0.1 : card.rarity === "secret" ? 0.16 : card.foil === "rainbow" ? 0.08 : 0
  const out = new Uint8ClampedArray(W * H * 4)
  const artW = new Float32Array(W * H)
  const reverse = card.foil === "reverse"
  const hasFoil = card.foil !== "none"
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sdArt = sdRoundRect(x, y, cx, cy, hw, hh, rr)
      const art = 1 - smooth(-f, f, sdArt)
      const sdCard = sdRoundRect(x, y, W / 2, H / 2, W / 2, H / 2, cardR)
      const inside = smooth(0, 0.01 * W, -sdCard)
      const i = y * W + x
      artW[i] = art
      // Slight luminance modulation: the foil "catches" the bright areas.
      const l = 0.78 + 0.22 * lum[i]
      let r = 0
      if (hasFoil) {
        r = reverse ? (1 - art) * inside * 0.9 : art * l
        if (!reverse && full > 0) r = Math.max(r, (1 - art) * inside * full)
      }
      const dEdge = -sdCard
      const band1 = smooth(0.003 * W, 0.009 * W, dEdge) * (1 - smooth(0.016 * W, 0.03 * W, dEdge))
      const band2 = (1 - smooth(0.004 * W, 0.016 * W, sdArt)) * smooth(-0.004 * W, 0.004 * W, sdArt)
      const g = Math.max(band1, band2)
      out[i * 4] = r * 255
      out[i * 4 + 1] = g * 255
      out[i * 4 + 2] = 0
      out[i * 4 + 3] = 255
    }
  }
  return { data: out, art: artW }
}

/** Normal map via Sobel on smoothed luminance; relief damped outside the artwork. */
export function buildNormal(lum: Float32Array, W: number, H: number, art: Float32Array, strength: number) {
  const blur = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(W - 1, Math.max(0, x + dx))
          const yy = Math.min(H - 1, Math.max(0, y + dy))
          s += lum[yy * W + xx]
        }
      blur[y * W + x] = s / 9
    }
  const out = new Uint8ClampedArray(W * H * 4)
  const h = (x: number, y: number) => blur[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)
      const dy = h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)
      const k = strength * (0.35 + 0.65 * art[y * W + x])
      let nx = -dx * k
      let ny = dy * k
      let nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      nz /= l
      const i = (y * W + x) * 4
      out[i] = (nx * 0.5 + 0.5) * 255
      out[i + 1] = (ny * 0.5 + 0.5) * 255
      out[i + 2] = (nz * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  return out
}

/** Data in canvas order (top to bottom) -> GL texture (bottom to top). */
function canvasTexture(data: Uint8ClampedArray, W: number, H: number, mips: boolean) {
  const flipped = new Uint8Array(W * H * 4)
  const row = W * 4
  for (let y = 0; y < H; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (H - 1 - y) * row)
  const t = new THREE.DataTexture(flipped, W, H)
  t.colorSpace = THREE.NoColorSpace
  t.flipY = false
  t.magFilter = THREE.LinearFilter
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.generateMipmaps = mips
  t.needsUpdate = true
  return t
}

async function build(card: CardDef): Promise<CardTextures> {
  const q = detectQuality()
  const W = q.maskWidth
  const H = Math.round(W * CARD_ASPECT)
  let source: CanvasImageSource
  try {
    source = await loadImage(card.image)
  } catch {
    source = placeholder(card)
  }
  const map = new THREE.Texture(source as HTMLImageElement)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = q.tier === "high" ? 8 : 4
  map.generateMipmaps = true
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.needsUpdate = true

  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const ctx = c.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0, W, H)
  const px = ctx.getImageData(0, 0, W, H).data
  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255

  const masks = buildMasks(card, W, H, lum)
  const normalData = buildNormal(lum, W, H, masks.art, 0.9)
  const mask = canvasTexture(masks.data, W, H, false)
  const normal = canvasTexture(normalData, W, H, true)
  normal.anisotropy = 2
  return {
    map,
    mask,
    normal,
    dispose: () => {
      map.dispose()
      mask.dispose()
      normal.dispose()
    },
  }
}

interface Entry {
  promise: Promise<CardTextures>
  value?: CardTextures
  refs: number
  last: number
}
const cache = new Map<string, Entry>()
const MAX_IDLE = 10

export function acquireTextures(card: CardDef): Promise<CardTextures> {
  let e = cache.get(card.id)
  if (!e) {
    const entry: Entry = { promise: null as unknown as Promise<CardTextures>, refs: 0, last: 0 }
    entry.promise = build(card).then((v) => {
      entry.value = v
      return v
    })
    entry.promise.catch(() => cache.delete(card.id))
    cache.set(card.id, entry)
    e = entry
  }
  e.refs++
  e.last = performance.now()
  return e.promise
}

export function releaseTextures(card: CardDef) {
  const e = cache.get(card.id)
  if (!e) return
  e.refs = Math.max(0, e.refs - 1)
  e.last = performance.now()
  const idle = [...cache.entries()].filter(([, v]) => v.refs === 0 && v.value).sort((a, b) => a[1].last - b[1].last)
  while (idle.length > MAX_IDLE) {
    const [k, v] = idle.shift()!
    v.value?.dispose()
    cache.delete(k)
  }
}

/** Counter for performance measurements. */
export const textureCacheSize = () => cache.size
