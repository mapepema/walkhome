import * as THREE from "three"
import type { Treatment } from "./treatments"

/** Foil hue spectra: the shader READS the colour from a 256x1 strip. */
const STOPS: Record<Treatment["spectrum"], [number, string][]> = {
  pastel: [
    [0, "#ffb3d9"], [0.18, "#ffe6a8"], [0.36, "#b8ffcf"], [0.56, "#9fe3ff"], [0.76, "#c7b3ff"], [1, "#ffb3d9"],
  ],
  cosmos: [
    [0, "#3a1d8f"], [0.2, "#1f7fd0"], [0.4, "#38e0c8"], [0.58, "#a35bff"], [0.78, "#ff5fb0"], [1, "#3a1d8f"],
  ],
  rainbow: [
    [0, "#ff4d6d"], [0.16, "#ffb02e"], [0.33, "#f4ff5a"], [0.5, "#39ffa0"], [0.66, "#35c8ff"], [0.83, "#9b5bff"], [1, "#ff4d6d"],
  ],
  gold: [
    [0, "#ffe9a3"], [0.2, "#ff9ad5"], [0.4, "#9be8ff"], [0.6, "#fff0b0"], [0.8, "#c7a0ff"], [1, "#ffe9a3"],
  ],
}

const cache = new Map<string, THREE.CanvasTexture>()

export function spectrumTexture(name: Treatment["spectrum"]): THREE.CanvasTexture {
  let tex = cache.get(name)
  if (tex) return tex
  const c = document.createElement("canvas")
  c.width = 256
  c.height = 2
  const ctx = c.getContext("2d")!
  const g = ctx.createLinearGradient(0, 0, 256, 0)
  for (const [o, col] of STOPS[name]) g.addColorStop(o, col)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 2)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  cache.set(name, tex)
  return tex
}

let grain: THREE.DataTexture | null = null
/** Tileable print grain, shared by all cards. */
export function grainTexture(): THREE.DataTexture {
  if (grain) return grain
  const n = 128
  const data = new Uint8Array(n * n * 4)
  let s = 1337
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < n * n; i++) {
    const v = 90 + Math.floor(rnd() * 76)
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  grain = new THREE.DataTexture(data, n, n)
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.magFilter = THREE.LinearFilter
  grain.minFilter = THREE.LinearMipmapLinearFilter
  grain.generateMipmaps = true
  grain.needsUpdate = true
  return grain
}
