import * as THREE from "three"

let tex: THREE.CanvasTexture | null = null

/** Shared card back (procedural, understated: midnight blue, gold rules, medallion). */
export function cardBackTexture(): THREE.CanvasTexture {
  if (tex) return tex
  const W = 480
  const H = 672
  const c = document.createElement("canvas")
  c.width = W
  c.height = H
  const ctx = c.getContext("2d")!
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, "#1c2740")
  g.addColorStop(0.5, "#101827")
  g.addColorStop(1, "#1a1f35")
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // diamond lattice
  ctx.strokeStyle = "rgba(217,178,95,0.10)"
  ctx.lineWidth = 1
  for (let i = -H; i < W + H; i += 28) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + H, H)
    ctx.moveTo(i, H)
    ctx.lineTo(i + H, 0)
    ctx.stroke()
  }
  ctx.strokeStyle = "#d9b25f"
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.roundRect(22, 22, W - 44, H - 44, 22)
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(36, 36, W - 72, H - 72, 14)
  ctx.stroke()
  const cx = W / 2
  const cy = H / 2
  const rg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 120)
  rg.addColorStop(0, "rgba(255,226,150,0.55)")
  rg.addColorStop(1, "rgba(217,178,95,0)")
  ctx.fillStyle = rg
  ctx.beginPath()
  ctx.arc(cx, cy, 120, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 3
  for (let r = 40; r <= 100; r += 30) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  // stylised path
  ctx.lineWidth = 6
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(cx - 60, cy + 60)
  ctx.bezierCurveTo(cx - 10, cy + 30, cx - 40, cy - 10, cx + 10, cy - 20)
  ctx.bezierCurveTo(cx + 40, cy - 25, cx + 30, cy - 55, cx + 62, cy - 62)
  ctx.stroke()
  ctx.fillStyle = "#d9b25f"
  ctx.font = '700 30px Cinzel, serif'
  ctx.textAlign = "center"
  ctx.fillText("WALKHOME", cx, H - 70)
  tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
