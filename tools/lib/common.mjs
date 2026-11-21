// Shared helpers for the card catalog builders (build_cards_*.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(ROOT, "frontend", "package.json"));
export const sharp = req("sharp");
export const canvasLib = req("@napi-rs/canvas");
export const FONT_PATH = process.env.CINZEL_TTF || path.join(ROOT, "frontend/public/fonts/Cinzel.ttf");
export const INTER_PATH = process.env.INTER_TTF || path.join(ROOT, "frontend/public/fonts/Inter.ttf");
let fontsDone = false;
export function registerFonts() {
  if (fontsDone) return;
  fontsDone = true;
  if (fs.existsSync(FONT_PATH)) canvasLib.GlobalFonts.registerFromPath(FONT_PATH, "Cinzel");
  else console.warn("! Cinzel.ttf not found:", FONT_PATH);
  if (fs.existsSync(INTER_PATH)) canvasLib.GlobalFonts.registerFromPath(INTER_PATH, "Inter");
}

export const RARITIES = ["common", "uncommon", "rare", "holo", "ultra", "secret"];

/** FNV-1a 32-bit, deterministic. */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export const unit = (s) => hash32(s) / 4294967296;

export function slugify(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Pack layout: exactly section 3 of the contract. */
export const PACK = {
  cards_per_pack: 5,
  slots: [
    { label: "Common or uncommon", odds: { common: 70, uncommon: 30 } },
    { label: "Common or uncommon", odds: { common: 70, uncommon: 30 } },
    { label: "Common or uncommon", odds: { common: 70, uncommon: 30 } },
    { label: "Rare or better", odds: { rare: 84, holo: 12, ultra: 3.5, secret: 0.5 } },
    { label: "Wildcard", odds: { common: 0, uncommon: 40, rare: 40, holo: 15, ultra: 4.5, secret: 0.5 } },
  ],
  pity: { rare_every: 5, ultra_every: 25 },
};

export function foilFor(rarity, key) {
  const u = unit("foil:" + key);
  switch (rarity) {
    case "rare": return "linear";
    case "holo": return u < 0.5 ? "cosmos" : "reverse";
    case "ultra": return u < 0.5 ? "rainbow" : "cosmos";
    case "secret": return "rainbow";
    default: return "none";
  }
}

export async function webp(buf, w, h, { q = 78, maxKB, minQ = 40, alpha = false } = {}) {
  let quality = q, out;
  for (;;) {
    out = await sharp(buf).resize(w, h, { fit: "cover", kernel: "lanczos3" })
      .webp({ quality, effort: 6, smartSubsample: true, alphaQuality: 90 }).toBuffer();
    if (!maxKB || out.length <= maxKB * 1024 || quality <= minQ) break;
    quality -= 4;
  }
  return { buf: out, quality };
}

// ---------------------------------------------------------------- pack wrappers
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
export function hexRgb(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
export const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const shade = (hex, t) => rgb(mix(hexRgb(hex), t >= 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(t)));

function drawEmblem(ctx, kind, cx, cy, R, accent) {
  const light = shade(accent, 0.55), dark = shade(accent, -0.55);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const poly = (n, r, rot = -Math.PI / 2) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const a = rot + (i * 2 * Math.PI) / n; ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath();
  };
  ctx.strokeStyle = light; ctx.fillStyle = light; ctx.lineWidth = 3;
  switch (kind % 8) {
    case 0: // nested triangles
      for (let i = 0; i < 4; i++) { poly(3, R * (1 - i * 0.22)); ctx.globalAlpha = 0.9 - i * 0.15; ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(0, R * 0.06, R * 0.1, 0, 7); ctx.fill(); break;
    case 1: // crescent + star
      ctx.beginPath(); ctx.arc(0, 0, R * 0.85, 0, 7); ctx.arc(R * 0.3, -R * 0.1, R * 0.7, 0, 7, true); ctx.fill("evenodd");
      poly(4, R * 0.3, 0); ctx.save(); ctx.translate(R * 0.25, 0); ctx.fill(); ctx.restore(); break;
    case 2: // diamonds (scales)
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        if (Math.abs(r) + Math.abs(c) > 2) continue;
        ctx.save(); ctx.translate(c * R * 0.42, r * R * 0.42); ctx.beginPath();
        ctx.moveTo(0, -R * 0.2); ctx.lineTo(R * 0.2, 0); ctx.lineTo(0, R * 0.2); ctx.lineTo(-R * 0.2, 0); ctx.closePath();
        ctx.globalAlpha = (r + c) % 2 ? 0.45 : 0.95; ctx.fill(); ctx.restore();
      } break;
    case 3: // abstract eye (almond + ring)
      ctx.beginPath(); ctx.moveTo(-R, 0); ctx.quadraticCurveTo(0, -R * 0.9, R, 0); ctx.quadraticCurveTo(0, R * 0.9, -R, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, R * 0.33, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, 0, R * 0.09, R * 0.27, 0, 0, 7); ctx.fill();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * 2 * Math.PI; if (Math.abs(Math.sin(a)) < 0.45) continue;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5); ctx.lineTo(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95); ctx.stroke(); } break;
    case 4: // shield + chevrons
      ctx.beginPath(); ctx.moveTo(-R * 0.7, -R * 0.8); ctx.lineTo(R * 0.7, -R * 0.8); ctx.lineTo(R * 0.7, 0); ctx.quadraticCurveTo(R * 0.6, R * 0.6, 0, R); ctx.quadraticCurveTo(-R * 0.6, R * 0.6, -R * 0.7, 0); ctx.closePath(); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-R * 0.45, -R * 0.35 + i * R * 0.3); ctx.lineTo(0, -R * 0.05 + i * R * 0.3); ctx.lineTo(R * 0.45, -R * 0.35 + i * R * 0.3); ctx.stroke(); } break;
    case 5: // eight-pointed star
      for (let i = 0; i < 8; i++) { ctx.save(); ctx.rotate((i * Math.PI) / 4); ctx.beginPath(); ctx.moveTo(0, -R * 0.12); ctx.lineTo(R * 0.09, -R * 0.55); ctx.lineTo(0, -R); ctx.lineTo(-R * 0.09, -R * 0.55); ctx.closePath(); ctx.globalAlpha = i % 2 ? 0.55 : 1; ctx.fill(); ctx.restore(); }
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(0, 0, R * 0.22, 0, 7); ctx.stroke(); break;
    case 6: // flames (spikes)
      for (let i = -2; i <= 2; i++) { const h = R * (1.05 - Math.abs(i) * 0.22);
        ctx.beginPath(); ctx.moveTo(i * R * 0.34 - R * 0.17, R * 0.8); ctx.quadraticCurveTo(i * R * 0.34 - R * 0.12, R * 0.1, i * R * 0.34, R * 0.8 - h * 1.5 + R * 0.75); ctx.quadraticCurveTo(i * R * 0.34 + R * 0.12, R * 0.1, i * R * 0.34 + R * 0.17, R * 0.8); ctx.closePath();
        ctx.globalAlpha = 1 - Math.abs(i) * 0.15; ctx.fill(); } break;
    case 7: // constellation
      { const pts = [[-0.8, 0.5], [-0.4, -0.1], [0, 0.25], [0.35, -0.55], [0.8, -0.2], [0.55, 0.65]];
        ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x * R, y * R)); ctx.lineWidth = 2; ctx.stroke();
        pts.forEach(([x, y], i) => { ctx.beginPath(); ctx.arc(x * R, y * R, R * (0.07 + (i % 3) * 0.03), 0, 7); ctx.fill(); }); }
      break;
  }
  ctx.restore();
  void dark;
}

/** 360x640 pack wrapper: gradient, geometric emblem, name in Cinzel. Transparent outside the wrapper. */
export async function makePack({ title, kicker = "", footer = "5 cards", accent, emblem = 0, textDark = false, seed = "" }) {
  registerFonts();
  const W = 360, H = 640, c = canvasLib.createCanvas(W, H), ctx = c.getContext("2d");
  const body = new canvasLib.Path2D();
  const crimp = 26, tooth = 6; // crimped top/bottom edges
  const edge = (y0, dir) => {
    for (let x = 0; x <= W; x += tooth * 2) { body.lineTo(x, y0); body.lineTo(x + tooth, y0 + dir * 8); }
  };
  body.moveTo(0, 14); edge(14, -1); body.lineTo(W, H - 14);
  for (let x = W; x >= 0; x -= tooth * 2) { body.lineTo(x, H - 14); body.lineTo(x - tooth, H - 6); }
  body.closePath();
  ctx.save(); ctx.clip(body);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(accent, 0.35)); g.addColorStop(0.45, shade(accent, -0.1)); g.addColorStop(1, shade(accent, -0.68));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // vertical highlights
  const sh = ctx.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.12, "rgba(255,255,255,0.22)"); sh.addColorStop(0.2, "rgba(255,255,255,0)");
  sh.addColorStop(0.78, "rgba(255,255,255,0)"); sh.addColorStop(0.9, "rgba(255,255,255,0.16)"); sh.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
  // subtle pattern (diamond lattice)
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 36) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + H, 0); ctx.lineTo(i, H); ctx.stroke(); }
  // crimp bands
  for (const y of [crimp + 8, H - crimp - 14]) { const b = ctx.createLinearGradient(0, y - 12, 0, y + 12); b.addColorStop(0, "rgba(0,0,0,0.35)"); b.addColorStop(0.5, "rgba(255,255,255,0.18)"); b.addColorStop(1, "rgba(0,0,0,0.3)"); ctx.fillStyle = b; ctx.fillRect(0, y - 12, W, 24); }
  // halo + medallion
  const cx = W / 2, cy = 270;
  const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, 190);
  halo.addColorStop(0, "rgba(255,255,255,0.35)"); halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo; ctx.fillRect(0, 60, W, 420);
  ctx.beginPath(); ctx.arc(cx, cy, 128, 0, 7); ctx.fillStyle = "rgba(0,0,0,0.30)"; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = shade(accent, 0.6); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 138, 0, 7); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.stroke();
  drawEmblem(ctx, emblem, cx, cy, 86, accent);
  // text
  const ink = textDark ? "#10141c" : "#fff8ea";
  ctx.textAlign = "center"; ctx.fillStyle = ink;
  ctx.shadowColor = textDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.55)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const lines = wrap(ctx, title.toUpperCase(), 300, (s) => `700 ${s}px Cinzel`, 34);
  let y = 462;
  for (const [t, s] of lines) { ctx.font = `700 ${s}px Cinzel`; ctx.fillText(t, cx, y); y += s + 6; }
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (kicker) { ctx.font = "600 15px Cinzel"; ctx.globalAlpha = 0.85; ctx.fillText(kicker.toUpperCase(), cx, 92); ctx.globalAlpha = 1; }
  ctx.font = "600 14px Cinzel"; ctx.globalAlpha = 0.8; ctx.fillText(footer.toUpperCase(), cx, H - 52); ctx.globalAlpha = 1;
  // light noise against banding
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = ((hash32(seed + i) & 7) - 3.5); d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 2; ctx.stroke(body);
  return sharp(c.toBuffer("image/png")).webp({ quality: 86, effort: 6, alphaQuality: 95 }).toBuffer();
}

function wrap(ctx, text, maxW, font, start) {
  const words = text.split(/\s+/);
  const fits = (t, s) => { ctx.font = font(s); return ctx.measureText(t).width <= maxW; };
  for (let s = start; s >= 18; s -= 2) {
    // try one line, then two balanced lines
    if (fits(text, s)) return [[text, s]];
    for (let k = 1; k < words.length; k++) {
      const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
      if (fits(a, s) && fits(b, s)) return [[a, s], [b, s]];
    }
  }
  return [[text, 18]];
}

export function writeJson(file, obj, compact = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, compact ? 0 : 1) + "\n");
}
export function mapLimit(items, n, fn) {
  let i = 0;
  return Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
