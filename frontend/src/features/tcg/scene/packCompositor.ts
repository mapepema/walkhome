/**
 * Pack wrapper art, composed on canvas from the set data (accent colour,
 * name). If `set.cover` exists, the image is used as the front face and only the
 * tear-off strip is drawn on top.
 */
export const PACK_W = 1024
export const PACK_H = 1460
/** Height of the tear-off strip, as a fraction of the wrapper height. */
export const TEAR_BAND = 0.14

export interface PackArt {
  accent: string
  title: string
  subtitle?: string
  cards: number
  cover?: HTMLImageElement | null
}

function canvas2d(w: number, h: number) {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const ctx = c.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D unavailable")
  return { c, ctx }
}

function tearBand(ctx: CanvasRenderingContext2D, label: boolean) {
  const band = PACK_H * TEAR_BAND
  ctx.fillStyle = "rgba(0,0,0,0.3)"
  ctx.fillRect(0, 0, PACK_W, band)
  ctx.strokeStyle = "rgba(255,255,255,0.5)"
  ctx.lineWidth = 5
  ctx.setLineDash([16, 14])
  ctx.beginPath()
  ctx.moveTo(0, band)
  ctx.lineTo(PACK_W, band)
  ctx.stroke()
  ctx.setLineDash([])
  if (label) {
    ctx.fillStyle = "rgba(255,255,255,0.6)"
    ctx.font = '600 30px "Inter", ui-sans-serif, sans-serif'
    ctx.textAlign = "center"
    ctx.fillText("TEAR HERE", PACK_W / 2, band - 52)
  }
}

export function compositePackFront(art: PackArt): HTMLCanvasElement {
  const { c, ctx } = canvas2d(PACK_W, PACK_H)
  const accent = art.accent
  if (art.cover) {
    // pack.webp (360x640, alpha): drawn "contain" on a dark tinted background.
    const bgc = ctx.createLinearGradient(0, 0, 0, PACK_H)
    bgc.addColorStop(0, "#0b1020")
    bgc.addColorStop(1, "#05070d")
    ctx.fillStyle = bgc
    ctx.fillRect(0, 0, PACK_W, PACK_H)
    const img = art.cover
    const s = Math.min(PACK_W / img.width, PACK_H / img.height)
    ctx.drawImage(img, (PACK_W - img.width * s) / 2, (PACK_H - img.height * s) / 2, img.width * s, img.height * s)
    tearBand(ctx, true)
    return c
  }
  const bg = ctx.createLinearGradient(0, 0, PACK_W, PACK_H)
  bg.addColorStop(0, "#0b1020")
  bg.addColorStop(0.3, accent)
  bg.addColorStop(0.55, accent)
  bg.addColorStop(0.8, "#131a2e")
  bg.addColorStop(1, "#070a14")
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, PACK_W, PACK_H)

  ctx.save()
  ctx.globalCompositeOperation = "screen"
  ctx.translate(PACK_W / 2, PACK_H / 2)
  ctx.rotate(-0.5)
  for (let i = -14; i < 14; i++) {
    ctx.fillStyle = `rgba(255,255,255,${i % 2 ? 0.05 : 0.014})`
    ctx.fillRect(i * 90, -PACK_H, 52, PACK_H * 2)
  }
  ctx.restore()
  tearBand(ctx, true)

  const cx = PACK_W / 2
  const cy = PACK_H * 0.46
  ctx.save()
  ctx.translate(cx, cy)
  for (let i = 0; i < 10; i++) {
    ctx.rotate((Math.PI * 2) / 10)
    ctx.strokeStyle = "rgba(255,255,255,0.18)"
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.ellipse(0, 0, 250, 96, 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, cy, 132, 0, Math.PI * 2)
  ctx.fillStyle = "rgba(6,9,18,0.72)"
  ctx.fill()
  ctx.strokeStyle = "#ffffff"
  ctx.lineWidth = 7
  ctx.stroke()
  ctx.fillStyle = "#ffffff"
  ctx.textAlign = "center"
  ctx.font = '900 92px "Cinzel", ui-serif, serif'
  ctx.fillText("W", cx, cy + 32)

  ctx.fillStyle = "#ffffff"
  let size = 92
  ctx.font = `800 ${size}px "Cinzel", ui-serif, serif`
  const title = art.title.toUpperCase()
  while (ctx.measureText(title).width > PACK_W - 160 && size > 40) {
    size -= 4
    ctx.font = `800 ${size}px "Cinzel", ui-serif, serif`
  }
  ctx.fillText(title, cx, PACK_H * 0.72)
  if (art.subtitle) {
    ctx.fillStyle = "rgba(255,255,255,0.7)"
    ctx.font = '700 34px "Inter", ui-sans-serif, sans-serif'
    ctx.fillText(art.subtitle.toUpperCase(), cx, PACK_H * 0.77)
  }
  ctx.fillStyle = "#fff"
  ctx.globalAlpha = 0.85
  ctx.font = '700 30px "Inter", ui-sans-serif, sans-serif'
  ctx.fillText(`${art.cards} CARDS`, cx, PACK_H * 0.86)
  ctx.globalAlpha = 1

  ctx.strokeStyle = "rgba(255,255,255,0.3)"
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.roundRect(22, 22, PACK_W - 44, PACK_H - 44, 26)
  ctx.stroke()
  return c
}

export function compositePackBack(art: PackArt): HTMLCanvasElement {
  const { c, ctx } = canvas2d(PACK_W, PACK_H)
  const bg = ctx.createLinearGradient(0, 0, 0, PACK_H)
  bg.addColorStop(0, "#0a0e1a")
  bg.addColorStop(0.5, "#111726")
  bg.addColorStop(1, "#070a14")
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, PACK_W, PACK_H)
  tearBand(ctx, false)
  ctx.textAlign = "center"
  ctx.fillStyle = art.accent
  ctx.font = '800 60px "Cinzel", ui-serif, serif'
  ctx.fillText(art.title.toUpperCase(), PACK_W / 2, PACK_H * 0.32, PACK_W - 120)
  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.font = '600 26px "Inter", ui-sans-serif, sans-serif'
  ;[`Contains ${art.cards} collectible cards.`, "Cards may differ from those pictured.", "Earned by walking."].forEach((l, i) =>
    ctx.fillText(l, PACK_W / 2, PACK_H * 0.52 + i * 42),
  )
  ctx.strokeStyle = "rgba(255,255,255,0.18)"
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.roundRect(22, 22, PACK_W - 44, PACK_H - 44, 26)
  ctx.stroke()
  return c
}
