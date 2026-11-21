#!/usr/bin/env node
// "Embers & Peaks" deck: 120 original procedural cards (2 sets), freely redistributable.
// Its catalog is published under the journey it rewards (THEME).
// Usage: node tools/build_cards.mjs [--force] [--only <slug>]
import fs from "node:fs";
import path from "node:path";
import { ROOT, sharp, canvasLib, registerFonts, PACK, foilFor, hash32, unit, slugify, webp, makePack, writeJson, shade, hexRgb, rgb } from "./lib/common.mjs";
import { SETS, SUBTITLE, CARDS, LEGENDARY } from "./data/embers_peaks_cards.mjs";

// Journey whose walkers draw from this deck, and the deck's asset folder.
const THEME = "camino";
const DECK = "embers-peaks";

const flag = (n) => process.argv.includes(n);
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const OUT = path.join(ROOT, "frontend/public/cards", DECK);
registerFonts();

const W = 480, H = 672, S = 2;                       // logical 480x672 coordinates, rendered at 2x then downscaled
const ART = [0.075, 0.115, 0.85, 0.5];               // normalised art_rect
const AX = ART[0] * W, AY = ART[1] * H, AW = ART[2] * W, AH = ART[3] * H;

// ---------------------------------------------------------------- illustration palettes
const PALS = {
  ember:   { sky: ["#1a0a10", "#5a1a1c", "#e2561f"], far: "#3a1218", mid: "#240b10", near: "#12060a", glow: "#ff8a3c", accent: "#ffd27a", ink: "#fff1d6", bg: "#2a0e12" },
  magma:   { sky: ["#12060a", "#451018", "#a8231c"], far: "#30090f", mid: "#1d070c", near: "#0c0306", glow: "#ff5a2a", accent: "#ffb347", ink: "#ffe9cc", bg: "#220a0e" },
  ash:     { sky: ["#1b1a1e", "#45393b", "#9b6a52"], far: "#383034", mid: "#272024", near: "#141012", glow: "#ffb066", accent: "#ffe0a8", ink: "#f4eadb", bg: "#242022" },
  dusk:    { sky: ["#1a0f2a", "#6a2a45", "#f08a4a"], far: "#432040", mid: "#2a1530", near: "#150a1c", glow: "#ffc36b", accent: "#ffe9a8", ink: "#fff0dc", bg: "#25132b" },
  glacier: { sky: ["#0b1a2e", "#245a82", "#9fd8ee"], far: "#2c5b80", mid: "#1b3e5e", near: "#0d2036", glow: "#bfeaff", accent: "#ffffff", ink: "#eaf7ff", bg: "#10243a" },
  aurora:  { sky: ["#050f1e", "#0e3a4a", "#1e8a78"], far: "#14405a", mid: "#0c2a40", near: "#061420", glow: "#6dffc2", accent: "#b9a6ff", ink: "#e6fff5", bg: "#08202c" },
  night:   { sky: ["#06081c", "#1a1e4c", "#4a4f9a"], far: "#242a60", mid: "#161a42", near: "#0a0c24", glow: "#a9b8ff", accent: "#ffe9a8", ink: "#eef0ff", bg: "#0c0f2c" },
  dawn:    { sky: ["#1a2a5a", "#7a6aa8", "#ffc0a0"], far: "#6a6aa0", mid: "#3e4678", near: "#1e2448", glow: "#ffe0b0", accent: "#fff6dc", ink: "#fff8ee", bg: "#1c2650" },
};
const FRAMES = {
  common:   ["#b3a08a", "#6a5a48", "#2b241d"],
  uncommon: ["#b8e0c4", "#5f9a74", "#1f3a2a"],
  rare:     ["#a9c9f5", "#4f7fc4", "#1a2d52"],
  holo:     ["#e3c8ff", "#8b5cd0", "#2d1a52"],
  ultra:    ["#ffe0a0", "#d9993f", "#4a2a12"],
  secret:   ["#f6efd8", "#c9b46a", "#0a0a0c"],
};
const GEMS = { common: 1, uncommon: 2, rare: 3, holo: 4, ultra: 5, secret: 6 };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- primitives
function glow(ctx, x, y, r, color, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const c = hexRgb(color);
  g.addColorStop(0, rgb(c, a)); g.addColorStop(0.4, rgb(c, a * 0.35)); g.addColorStop(1, rgb(c, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function sky(ctx, p, A) {
  const g = ctx.createLinearGradient(0, A.y, 0, A.y + A.h);
  g.addColorStop(0, p.sky[0]); g.addColorStop(0.55, p.sky[1]); g.addColorStop(1, p.sky[2]);
  ctx.fillStyle = g; ctx.fillRect(A.x, A.y, A.w, A.h);
}
function stars(ctx, p, A, r, n = 70, maxY = 1) {
  for (let i = 0; i < n; i++) {
    const x = A.x + r() * A.w, y = A.y + r() * A.h * maxY, s = 0.4 + r() * r() * 1.8;
    ctx.globalAlpha = 0.35 + r() * 0.65; ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
    if (s > 1.7) { ctx.globalAlpha *= 0.5; ctx.fillRect(x - s * 3, y - 0.4, s * 6, 0.8); ctx.fillRect(x - 0.4, y - s * 3, 0.8, s * 6); }
  }
  ctx.globalAlpha = 1;
}
function embers(ctx, p, A, r, n = 40, y0 = 1) {
  for (let i = 0; i < n; i++) {
    const x = A.x + r() * A.w, y = A.y + A.h * (y0 - r() * r() * 0.9), s = 0.6 + r() * 1.6;
    ctx.globalAlpha = 0.4 + r() * 0.6; ctx.fillStyle = r() < 0.5 ? p.glow : p.accent; ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
    glow(ctx, x, y, s * 5, p.glow, 0.35);
  }
  ctx.globalAlpha = 1;
}
function ridge(ctx, A, r, base, amp, color, rough = 6, snow = null) {
  const pts = []; const n = 14;
  for (let i = 0; i <= n; i++) pts.push([A.x + (A.w * i) / n, A.y + A.h * base - amp * (r() * 0.7 + 0.3 * Math.sin(i * 0.9 + r()))]);
  // pseudo-fractal subdivision
  let poly = pts;
  for (let k = 0; k < 3; k++) { const out = []; for (let i = 0; i < poly.length - 1; i++) { const a = poly[i], b = poly[i + 1]; out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + (r() - 0.5) * rough * (3 - k)]); } out.push(poly.at(-1)); poly = out; }
  ctx.beginPath(); ctx.moveTo(A.x, A.y + A.h); poly.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(A.x + A.w, A.y + A.h); ctx.closePath();
  const g = ctx.createLinearGradient(0, A.y + A.h * (base - 0.25), 0, A.y + A.h);
  g.addColorStop(0, snow || shade(color, 0.12)); g.addColorStop(0.3, color); g.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = g; ctx.fill();
  return poly;
}
function fog(ctx, A, y, color, a = 0.3) {
  const g = ctx.createLinearGradient(0, A.y + A.h * y - 40, 0, A.y + A.h * y + 40);
  const c = hexRgb(color); g.addColorStop(0, rgb(c, 0)); g.addColorStop(0.5, rgb(c, a)); g.addColorStop(1, rgb(c, 0));
  ctx.fillStyle = g; ctx.fillRect(A.x, A.y + A.h * y - 40, A.w, 80);
}
function poly(ctx, pts) { ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y)); ctx.closePath(); }

// ---------------------------------------------------------------- motifs
const M = {};
M.mountains = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 40, 0.5);
  const sx = A.x + A.w * (0.25 + r() * 0.5), sy = A.y + A.h * (0.28 + r() * 0.12);
  glow(ctx, sx, sy, 130, p.glow, 0.8); ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(sx, sy, 17 + r() * 8, 0, 7); ctx.fill();
  ridge(ctx, A, r, 0.52, 120, p.far, 8, p.accent); fog(ctx, A, 0.62, p.glow, 0.25);
  ridge(ctx, A, r, 0.68, 90, p.mid, 7, shade(p.mid, 0.35)); fog(ctx, A, 0.78, p.glow, 0.2);
  ridge(ctx, A, r, 0.86, 60, p.near, 6);
};
M.volcano = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 30, 0.4);
  const cx = A.x + A.w * 0.5, top = A.y + A.h * 0.3, base = A.y + A.h * 0.9;
  glow(ctx, cx, top, 200, p.glow, 0.9);
  for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.18; ctx.fillStyle = shade(p.mid, 0.2); ctx.beginPath(); ctx.ellipse(cx + (r() - 0.5) * 90, top - 20 - i * 22, 40 + i * 14, 18 + i * 5, 0, 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;
  ridge(ctx, A, r, 0.6, 70, p.far, 5);
  poly(ctx, [[A.x - 20, base], [cx - 38, top], [cx - 14, top - 8], [cx + 14, top - 8], [cx + 38, top], [A.x + A.w + 20, base]]);
  const g = ctx.createLinearGradient(0, top, 0, base); g.addColorStop(0, shade(p.mid, 0.25)); g.addColorStop(1, p.near); ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.shadowColor = p.glow; ctx.shadowBlur = 14; ctx.strokeStyle = p.glow; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  for (let i = 0; i < 5; i++) { let x = cx + (r() - 0.5) * 24, y = top; ctx.beginPath(); ctx.moveTo(x, y); while (y < base - 20) { x += (r() - 0.5) * 22 + (x < cx ? -4 : 4); y += 16 + r() * 18; ctx.lineTo(x, y); } ctx.globalAlpha = 0.5 + r() * 0.5; ctx.stroke(); }
  ctx.restore(); ctx.globalAlpha = 1;
  ctx.fillStyle = p.glow; ctx.beginPath(); ctx.ellipse(cx, top - 4, 30, 7, 0, 0, 7); ctx.fill(); glow(ctx, cx, top - 6, 60, p.accent, 0.9);
  embers(ctx, p, A, r, 45, 0.7); ridge(ctx, A, r, 0.97, 30, p.near, 4);
};
M.constellation = (ctx, p, A, r) => {
  sky(ctx, p, A); ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 4; i++) glow(ctx, A.x + r() * A.w, A.y + r() * A.h * 0.8, 90 + r() * 90, i % 2 ? p.glow : p.accent, 0.35);
  ctx.globalCompositeOperation = "source-over"; stars(ctx, p, A, r, 160);
  const n = 7 + Math.floor(r() * 3), pts = [];
  for (let i = 0; i < n; i++) pts.push([A.x + A.w * (0.12 + 0.76 * (i / (n - 1)) + (r() - 0.5) * 0.06), A.y + A.h * (0.2 + r() * 0.5)]);
  ctx.strokeStyle = p.accent; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7; ctx.setLineDash([4, 5]); ctx.beginPath(); pts.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x, y)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  pts.forEach(([x, y], i) => { glow(ctx, x, y, 22, p.glow, 0.8); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 2.4 + (i % 3), 0, 7); ctx.fill(); ctx.fillRect(x - 9, y - 0.5, 18, 1); ctx.fillRect(x - 0.5, y - 9, 1, 18); });
  ridge(ctx, A, r, 0.94, 40, p.near, 5);
};
M.rune = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 40);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.5;
  glow(ctx, cx, cy, 190, p.glow, 0.55);
  ctx.strokeStyle = p.accent; ctx.lineCap = "round";
  for (const [rad, lw, al] of [[140, 1.2, 0.5], [122, 3, 0.8], [104, 1, 0.5]]) { ctx.lineWidth = lw; ctx.globalAlpha = al; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke(); }
  ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5;
  for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI, l = i % 4 ? 6 : 14; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 122, cy + Math.sin(a) * 122); ctx.lineTo(cx + Math.cos(a) * (122 + l), cy + Math.sin(a) * (122 + l)); ctx.stroke(); }
  // glyph: stem + 3..4 branches
  ctx.save(); ctx.shadowColor = p.glow; ctx.shadowBlur = 22; ctx.strokeStyle = p.accent; ctx.globalAlpha = 1; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(cx, cy - 80); ctx.lineTo(cx, cy + 80);
  const nb = 3 + Math.floor(r() * 2);
  for (let i = 0; i < nb; i++) { const y = cy - 70 + (140 / nb) * i + r() * 14, side = r() < 0.5 ? -1 : 1, d = 30 + r() * 30, dy = (r() < 0.5 ? -1 : 1) * (20 + r() * 25); ctx.moveTo(cx, y); ctx.lineTo(cx + side * d, y + dy); if (r() < 0.4) { ctx.moveTo(cx + side * d, y + dy); ctx.lineTo(cx + side * (d + 22), y + dy + 14); } }
  ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
  embers(ctx, p, A, r, 24, 0.9);
};
M.flame = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 25, 0.5);
  const cx = A.x + A.w / 2, by = A.y + A.h * 0.88;
  glow(ctx, cx, by - 90, 200, p.glow, 0.7);
  const tear = (h, w, col, a, off = 0) => { ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx + off, by); ctx.bezierCurveTo(cx + off - w * 1.3, by - h * 0.3, cx + off - w * 0.5, by - h * 0.65, cx + off + (r() - 0.5) * 14, by - h); ctx.bezierCurveTo(cx + off + w * 0.5, by - h * 0.62, cx + off + w * 1.3, by - h * 0.3, cx + off, by); ctx.fill(); };
  tear(235, 70, shade(p.glow, -0.35), 0.9, -26); tear(215, 62, shade(p.glow, -0.2), 0.9, 30);
  tear(200, 56, p.glow, 1); tear(135, 34, p.accent, 0.95); tear(80, 18, "#fff", 0.9);
  ctx.globalAlpha = 1; embers(ctx, p, A, r, 50, 0.85);
  ctx.fillStyle = p.near; ctx.fillRect(A.x, by - 4, A.w, A.h * 0.2);
  ridge(ctx, A, r, 0.97, 20, p.near, 3);
};
M.crystal = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 40, 0.6);
  const cx = A.x + A.w / 2, by = A.y + A.h * 0.9;
  glow(ctx, cx, by - 100, 190, p.glow, 0.6);
  const shard = (x, h, w, lean) => {
    const top = [x + lean, by - h], l = [x - w / 2, by], rr = [x + w / 2, by], m = [x + lean * 0.3, by - h * 0.25];
    poly(ctx, [top, rr, l]); const g = ctx.createLinearGradient(x - w, by - h, x + w, by); g.addColorStop(0, shade(p.glow, 0.5)); g.addColorStop(1, shade(p.glow, -0.45)); ctx.fillStyle = g; ctx.fill();
    poly(ctx, [top, m, l]); ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fill();
    poly(ctx, [top, rr, m]); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1; poly(ctx, [top, rr, l]); ctx.stroke();
  };
  [[-120, 110, 50, -12], [120, 120, 54, 14], [-70, 160, 60, -8], [75, 175, 64, 10], [0, 230, 80, 0]].forEach(([dx, h, w, l]) => shard(cx + dx, h * (0.9 + r() * 0.2), w, l));
  embers(ctx, p, A, r, 22, 0.9); ridge(ctx, A, r, 0.97, 24, p.near, 4);
};
M.tower = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 60, 0.6);
  const mx = A.x + A.w * 0.75, my = A.y + A.h * 0.22; glow(ctx, mx, my, 110, p.glow, 0.7); ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(mx, my, 20, 0, 7); ctx.fill();
  ridge(ctx, A, r, 0.6, 80, p.far, 6, shade(p.far, 0.25)); fog(ctx, A, 0.72, p.glow, 0.2);
  const cx = A.x + A.w * 0.4, by = A.y + A.h * 0.92;
  ctx.fillStyle = p.near; poly(ctx, [[A.x, by + 20], [A.x, A.y + A.h * 0.78], [cx - 70, A.y + A.h * 0.7], [cx + 60, A.y + A.h * 0.72], [A.x + A.w, A.y + A.h * 0.84], [A.x + A.w, by + 20]]); ctx.fill();
  const tw = 46, th = 170, tx = cx - tw / 2, ty = by - th;
  ctx.fillStyle = shade(p.mid, -0.2); ctx.fillRect(tx, ty, tw, th);
  poly(ctx, [[tx - 8, ty], [cx, ty - 58], [tx + tw + 8, ty]]); ctx.fillStyle = p.near; ctx.fill();
  ctx.fillRect(tx - 6, ty - 3, tw + 12, 8);
  for (let i = 0; i < 4; i++) { const wy = ty + 22 + i * 36, lit = r() < 0.75; ctx.fillStyle = lit ? p.glow : "#000"; ctx.fillRect(cx - 4, wy, 8, 16); if (lit) glow(ctx, cx, wy + 8, 28, p.glow, 0.5); }
  glow(ctx, cx, ty - 66, 40, p.glow, 0.9); ctx.fillStyle = p.accent; ctx.fillRect(cx - 1, ty - 76, 2, 14);
  ridge(ctx, A, r, 0.99, 20, p.near, 3);
};
M.gate = (ctx, p, A, r) => {
  sky(ctx, p, A);
  const cx = A.x + A.w / 2, by = A.y + A.h, aw = 120, ah = 220;
  glow(ctx, cx, by - 140, 190, p.glow, 0.95);
  ctx.save(); ctx.beginPath(); ctx.moveTo(cx - aw / 2, by); ctx.lineTo(cx - aw / 2, by - ah + aw / 2); ctx.arc(cx, by - ah + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(cx + aw / 2, by); ctx.closePath(); ctx.clip();
  const g = ctx.createLinearGradient(0, by - ah, 0, by); g.addColorStop(0, p.accent); g.addColorStop(0.6, p.glow); g.addColorStop(1, p.sky[1]); ctx.fillStyle = g; ctx.fillRect(cx - aw, by - ah - 10, aw * 2, ah + 10);
  ctx.globalAlpha = 0.5; ctx.strokeStyle = "#fff"; for (let i = 0; i < 9; i++) { ctx.lineWidth = 1 + r() * 2; ctx.beginPath(); ctx.moveTo(cx, by - ah * 0.6); ctx.lineTo(cx + (i - 4) * 40, by); ctx.stroke(); }
  ctx.restore(); ctx.globalAlpha = 1;
  // pillars + steps
  for (const s of [-1, 1]) { ctx.fillStyle = p.near; ctx.fillRect(cx + s * (aw / 2 + 4) - (s > 0 ? 0 : 38), by - ah + 40, 38, ah - 40); }
  ctx.fillStyle = p.near; ctx.beginPath(); ctx.arc(cx, by - ah + aw / 2, aw / 2 + 38, Math.PI, 0); ctx.arc(cx, by - ah + aw / 2, aw / 2, 0, Math.PI, true); ctx.fill();
  ctx.fillStyle = p.near; ctx.fillRect(A.x, by - 30, A.w, 30);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = shade(p.near, 0.05 + i * 0.03); ctx.fillRect(cx - 70 + i * 6, by - 8 - i * 7, 140 - i * 12, 7); }
  embers(ctx, p, A, r, 24, 0.9);
};
M.river = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 40, 0.4);
  const hy = A.y + A.h * 0.55, cx = A.x + A.w / 2;
  glow(ctx, cx, hy, 150, p.glow, 0.7);
  ridge(ctx, A, r, 0.52, 70, p.far, 6, shade(p.far, 0.3));
  const ground = ctx.createLinearGradient(0, hy, 0, A.y + A.h); ground.addColorStop(0, p.mid); ground.addColorStop(1, p.near); ctx.fillStyle = ground; ctx.fillRect(A.x, hy, A.w, A.y + A.h - hy);
  const wd = 14 + r() * 8; poly(ctx, [[cx - wd / 4, hy], [cx + wd / 4, hy], [cx + 120, A.y + A.h], [cx - 120, A.y + A.h]]);
  const rg = ctx.createLinearGradient(0, hy, 0, A.y + A.h); rg.addColorStop(0, p.glow); rg.addColorStop(1, shade(p.glow, -0.5)); ctx.fillStyle = rg; ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.2; for (let i = 0; i < 10; i++) { const t = r(), y = hy + (A.y + A.h - hy) * t * t; ctx.beginPath(); ctx.moveTo(cx - 100 * t * t, y); ctx.lineTo(cx + 100 * t * t, y + 2); ctx.stroke(); }
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const t = r(), x = cx + s * (60 + t * 170), y = hy + 10 + t * (A.h * 0.4); ctx.fillStyle = shade(p.near, -0.2); poly(ctx, [[x, y - 30 - t * 40], [x + 12 + t * 8, y], [x - 12 - t * 8, y]]); ctx.fill(); }
  fog(ctx, A, 0.58, p.glow, 0.25);
};
M.comet = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 110);
  const hx = A.x + A.w * 0.72, hy = A.y + A.h * 0.3, tx = A.x + A.w * 0.05, ty = A.y + A.h * 0.62;
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 28; i++) { const t = i / 28, x = hx + (tx - hx) * t, y = hy + (ty - hy) * t; glow(ctx, x + (r() - 0.5) * 16, y + (r() - 0.5) * 16, 6 + t * 40, i % 2 ? p.glow : p.accent, 0.22 * (1 - t)); }
  glow(ctx, hx, hy, 80, p.glow, 1); glow(ctx, hx, hy, 26, "#ffffff", 1); ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 7); ctx.fill();
  ridge(ctx, A, r, 0.8, 60, p.far, 6); ridge(ctx, A, r, 0.94, 40, p.near, 5);
};
M.aurora = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 100, 0.7);
  ctx.globalCompositeOperation = "screen";
  for (let k = 0; k < 4; k++) {
    const y0 = A.y + A.h * (0.2 + k * 0.1), col = k % 2 ? p.accent : p.glow;
    const g = ctx.createLinearGradient(0, y0 - 80, 0, y0 + 80); g.addColorStop(0, rgb(hexRgb(col), 0)); g.addColorStop(0.55, rgb(hexRgb(col), 0.55)); g.addColorStop(1, rgb(hexRgb(col), 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(A.x, y0);
    const ph = r() * 6; for (let x = 0; x <= A.w; x += 8) ctx.lineTo(A.x + x, y0 + Math.sin(x / 55 + ph) * 28 + Math.sin(x / 23 + ph * 2) * 8);
    for (let x = A.w; x >= 0; x -= 8) ctx.lineTo(A.x + x, y0 + 95 + Math.sin(x / 40 + ph) * 22);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ridge(ctx, A, r, 0.78, 70, p.far, 6, shade(p.far, 0.35)); ridge(ctx, A, r, 0.92, 45, p.near, 5);
  for (let i = 0; i < 9; i++) { const x = A.x + r() * A.w, y = A.y + A.h * (0.86 + r() * 0.1), h = 20 + r() * 26; ctx.fillStyle = shade(p.near, -0.3); poly(ctx, [[x, y - h], [x + h * 0.25, y], [x - h * 0.25, y]]); ctx.fill(); }
};
M.winged = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 50, 0.6);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.5;
  glow(ctx, cx, cy, 200, p.glow, 0.65); ctx.fillStyle = shade(p.glow, 0.2); ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(cx, cy, 110, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  for (const s of [-1, 1]) {
    for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
      const a = (-0.55 + (i / 8) * 1.25) * (1 - row * 0.1), len = (170 - row * 38) * (1 - Math.abs(i - 4) * 0.02 + (i / 8) * 0.12), w = 15 - row * 2;
      ctx.save(); ctx.translate(cx + s * 16, cy - 10 + row * 8); ctx.scale(s, 1); ctx.rotate(a - 0.15);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -w, len, 0); ctx.quadraticCurveTo(len * 0.5, w, 0, 0);
      const g = ctx.createLinearGradient(0, 0, len, 0); g.addColorStop(0, shade(p.glow, -0.35 + row * 0.1)); g.addColorStop(1, row === 0 ? p.accent : shade(p.glow, 0.25 - row * 0.1)); ctx.fillStyle = g; ctx.globalAlpha = 0.9 - row * 0.12; ctx.fill(); ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 5; i++) { const x = cx + (i - 2) * 11; ctx.fillStyle = i % 2 ? p.glow : shade(p.glow, -0.3); poly(ctx, [[x - 6, cy + 30], [x + 6, cy + 30], [x + (i - 2) * 5, cy + 120 + (2 - Math.abs(i - 2)) * 14]]); ctx.fill(); }
  ctx.fillStyle = shade(p.near, 0.15); ctx.beginPath(); ctx.ellipse(cx, cy + 6, 22, 46, 0, 0, 7); ctx.fill();
  ctx.fillStyle = shade(p.near, 0.1); ctx.beginPath(); ctx.arc(cx, cy - 52, 17, 0, 7); ctx.fill();
  ctx.fillStyle = p.accent; poly(ctx, [[cx - 6, cy - 50], [cx + 6, cy - 50], [cx, cy - 34]]); ctx.fill();
  ctx.fillStyle = p.glow; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * 7, cy - 56, 2.8, 0, 7); ctx.fill(); }
  embers(ctx, p, A, r, 35, 0.95);
};
M.stag = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 60, 0.7);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.62;
  glow(ctx, cx, cy - 70, 190, p.glow, 0.7); ctx.fillStyle = p.accent; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(cx, cy - 90, 80, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ridge(ctx, A, r, 0.82, 50, p.far, 5, shade(p.far, 0.3));
  const branch = (x, y, ang, len, d, s) => {
    if (d === 0 || len < 8) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.lineWidth = 1 + d * 1.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    branch(x2, y2, ang - 0.35 * s, len * 0.78, d - 1, s); branch(x + (x2 - x) * 0.5, y + (y2 - y) * 0.5, ang + 0.7 * s, len * 0.55, d - 1, s);
  };
  ctx.strokeStyle = p.near; ctx.lineCap = "round";
  for (const s of [-1, 1]) branch(cx + s * 22, cy - 46, -Math.PI / 2 + s * 0.55, 62, 5, s);
  ctx.fillStyle = p.near; poly(ctx, [[cx - 30, cy - 48], [cx + 30, cy - 48], [cx + 22, cy + 10], [cx, cy + 62], [cx - 22, cy + 10]]); ctx.fill();
  for (const s of [-1, 1]) { poly(ctx, [[cx + s * 26, cy - 44], [cx + s * 64, cy - 62], [cx + s * 36, cy - 22]]); ctx.fill(); }
  ctx.fillStyle = p.glow; for (const s of [-1, 1]) { poly(ctx, [[cx + s * 10, cy - 20], [cx + s * 22, cy - 26], [cx + s * 14, cy - 14]]); ctx.fill(); }
  ctx.fillStyle = p.near; ctx.fillRect(A.x, A.y + A.h * 0.9, A.w, A.h * 0.1); embers(ctx, p, A, r, 20, 0.9);
};
M.beast = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 40, 0.6);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.52;
  glow(ctx, cx, cy, 190, p.glow, 0.7);
  ctx.fillStyle = p.accent; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(cx, cy - 10, 108, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  const half = [[0, -70], [26, -62], [58, -122], [84, -108], [92, -30], [74, 30], [46, 78], [14, 108], [0, 112]];
  const mir = (pts) => pts.concat(pts.slice(0, -1).reverse().map(([x, y]) => [-x, y]));
  const fur = ctx.createLinearGradient(cx, cy - 120, cx, cy + 110); fur.addColorStop(0, shade(p.mid, 0.2)); fur.addColorStop(1, p.near);
  ctx.save(); ctx.translate(cx, cy); poly(ctx, mir(half)); ctx.fillStyle = fur; ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)"; for (const s of [-1, 1]) { poly(ctx, [[s * 4, -66], [s * 56, -112], [s * 70, -20]]); ctx.fill(); }
  ctx.fillStyle = "rgba(0,0,0,0.35)"; for (const s of [-1, 1]) { poly(ctx, [[s * 70, -20], [s * 46, 70], [s * 12, 40]]); ctx.fill(); poly(ctx, [[s * 60, -104], [s * 80, -100], [s * 70, -60]]); ctx.fill(); }
  ctx.shadowColor = p.glow; ctx.shadowBlur = 16; ctx.fillStyle = p.glow;
  for (const s of [-1, 1]) { poly(ctx, [[s * 14, -16], [s * 52, -30], [s * 40, -6], [s * 18, -2]]); ctx.fill(); }
  ctx.shadowBlur = 0; ctx.fillStyle = "#000"; poly(ctx, [[-10, 62], [10, 62], [0, 78]]); ctx.fill();
  ctx.restore(); ctx.fillStyle = p.near; ctx.fillRect(A.x, A.y + A.h * 0.92, A.w, A.h * 0.1); embers(ctx, p, A, r, 22, 0.9);
};
M.owl = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 60, 0.7);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.52;
  glow(ctx, cx, cy - 60, 190, p.glow, 0.6); ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(cx + 70, cy - 90, 46, 0, 7); ctx.fill();
  ctx.strokeStyle = p.near; ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(A.x, cy + 110); ctx.quadraticCurveTo(cx, cy + 90, A.x + A.w, cy + 120); ctx.stroke();
  ctx.fillStyle = shade(p.mid, 0.1); ctx.beginPath(); ctx.ellipse(cx, cy + 20, 70, 98, 0, 0, 7); ctx.fill();
  for (let row = 0; row < 5; row++) for (let i = -2; i <= 2; i++) { if (row === 0 && Math.abs(i) > 1) continue; ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + i * 22 + (row % 2) * 11, cy + 18 + row * 20, 12, 0.1, Math.PI - 0.1); ctx.stroke(); }
  ctx.fillStyle = shade(p.mid, 0.1); poly(ctx, [[cx - 62, cy - 62], [cx - 44, cy - 108], [cx - 20, cy - 70]]); ctx.fill(); poly(ctx, [[cx + 62, cy - 62], [cx + 44, cy - 108], [cx + 20, cy - 70]]); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy - 36, 66, 50, 0, 0, 7); ctx.fill();
  for (const s of [-1, 1]) { ctx.fillStyle = p.near; ctx.beginPath(); ctx.arc(cx + s * 28, cy - 38, 25, 0, 7); ctx.fill(); ctx.save(); ctx.shadowColor = p.glow; ctx.shadowBlur = 20; ctx.fillStyle = p.glow; ctx.beginPath(); ctx.arc(cx + s * 28, cy - 38, 17, 0, 7); ctx.fill(); ctx.restore(); ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(cx + s * 28, cy - 38, 7, 0, 7); ctx.fill(); }
  ctx.fillStyle = p.accent; poly(ctx, [[cx - 8, cy - 26], [cx + 8, cy - 26], [cx, cy - 4]]); ctx.fill();
  for (const s of [-1, 1]) { ctx.fillStyle = shade(p.mid, -0.15); poly(ctx, [[cx + s * 64, cy - 6], [cx + s * 102, cy + 40], [cx + s * 70, cy + 110], [cx + s * 54, cy + 40]]); ctx.fill(); }
  embers(ctx, p, A, r, 20, 0.9);
};
M.tree = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 50, 0.5);
  const cx = A.x + A.w / 2, by = A.y + A.h * 0.9;
  glow(ctx, cx, by - 150, 200, p.glow, 0.5);
  ridge(ctx, A, r, 0.75, 60, p.far, 5);
  const tips = [];
  const grow = (x, y, ang, len, d) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    ctx.strokeStyle = p.near; ctx.lineWidth = d * 1.7; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    if (d <= 1) { tips.push([x2, y2]); return; }
    grow(x2, y2, ang - 0.4 - r() * 0.25, len * 0.74, d - 1); grow(x2, y2, ang + 0.4 + r() * 0.25, len * 0.74, d - 1);
  };
  grow(cx, by, -Math.PI / 2, 62, 8);
  tips.forEach(([x, y]) => { glow(ctx, x, y, 14, r() < 0.5 ? p.glow : p.accent, 0.9); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); });
  ctx.fillStyle = p.near; ctx.beginPath(); ctx.ellipse(cx, by + 30, A.w, 50, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(A.x, by + 25, A.w, A.h);
  embers(ctx, p, A, r, 24, 0.9);
};
M.blade = (ctx, p, A, r) => {
  sky(ctx, p, A); stars(ctx, p, A, r, 60, 0.7);
  const cx = A.x + A.w / 2, cy = A.y + A.h * 0.5;
  glow(ctx, cx, cy, 200, p.glow, 0.75);
  ctx.strokeStyle = p.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4; for (const rad of [118, 130]) { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke(); } ctx.globalAlpha = 1;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.22);
  const g = ctx.createLinearGradient(-14, 0, 14, 0); g.addColorStop(0, shade(p.accent, -0.2)); g.addColorStop(0.5, "#fff"); g.addColorStop(1, shade(p.accent, -0.35));
  ctx.shadowColor = p.glow; ctx.shadowBlur = 18; ctx.fillStyle = g; poly(ctx, [[-15, -10], [15, -10], [12, -140], [0, -170], [-12, -140]]); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-1.5, -150, 3, 140);
  ctx.fillStyle = p.near; ctx.fillRect(-48, -14, 96, 12); poly(ctx, [[-48, -14], [-58, -22], [-58, 2], [-48, -2]]); ctx.fill(); poly(ctx, [[48, -14], [58, -22], [58, 2], [48, -2]]); ctx.fill();
  ctx.fillStyle = shade(p.mid, 0.15); ctx.fillRect(-7, -2, 14, 60); for (let i = 0; i < 5; i++) { ctx.fillStyle = p.glow; ctx.fillRect(-7, 6 + i * 11, 14, 2); }
  ctx.fillStyle = p.accent; ctx.beginPath(); ctx.arc(0, 66, 11, 0, 7); ctx.fill(); ctx.restore();
  embers(ctx, p, A, r, 30, 0.95);
};
M.winged_alias = M.winged;

// ---------------------------------------------------------------- card
function fit(ctx, text, maxW, make, start, min = 14) { let s = start; ctx.font = make(s); while (ctx.measureText(text).width > maxW && s > min) { s -= 1; ctx.font = make(s); } return s; }
function wrapLines(ctx, text, maxW) {
  const out = []; let line = "";
  for (const w of text.split(" ")) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawCard(def) {
  const { name, type, motif, flavor, set, rarity, number, total, palName, stats, subtitle } = def;
  const cv = canvasLib.createCanvas(W * S, H * S), ctx = cv.getContext("2d");
  ctx.scale(S, S);
  const p = PALS[palName], fr = FRAMES[rarity], seed = hash32(def.id), r = rng(seed);
  // background + frame
  rr(ctx, 0, 0, W, H, 24); ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, fr[0]); bg.addColorStop(0.35, fr[1]); bg.addColorStop(0.7, fr[0]); bg.addColorStop(1, fr[1]);
  if (rarity === "secret") { bg.addColorStop(0, "#1a1424"); bg.addColorStop(0.3, "#c9b46a"); bg.addColorStop(0.5, "#0e0c14"); bg.addColorStop(0.75, "#e9d8a0"); bg.addColorStop(1, "#17121f"); }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  rr(ctx, 9, 9, W - 18, H - 18, 17); ctx.fillStyle = p.bg; ctx.fill();
  const inner = ctx.createLinearGradient(0, 0, 0, H); inner.addColorStop(0, shade(p.bg, 0.12)); inner.addColorStop(0.5, p.bg); inner.addColorStop(1, shade(p.bg, -0.4)); rr(ctx, 9, 9, W - 18, H - 18, 17); ctx.fillStyle = inner; ctx.fill();
  ctx.strokeStyle = fr[0]; ctx.lineWidth = 1.2; rr(ctx, 14, 14, W - 28, H - 28, 13); ctx.stroke();
  if (GEMS[rarity] >= 4) { ctx.strokeStyle = fr[1]; ctx.globalAlpha = 0.7; rr(ctx, 18, 18, W - 36, H - 36, 10); ctx.stroke(); ctx.globalAlpha = 1; }
  // subtle background pattern (diamonds)
  ctx.save(); ctx.globalAlpha = 0.05; ctx.strokeStyle = fr[0]; ctx.lineWidth = 1;
  for (let i = -H; i < W + H; i += 28) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + H, H); ctx.stroke(); ctx.beginPath(); ctx.moveTo(i + H, 0); ctx.lineTo(i, H); ctx.stroke(); }
  ctx.restore();
  // title plate
  const tp = ctx.createLinearGradient(0, 24, 0, 70); tp.addColorStop(0, shade(p.bg, 0.25)); tp.addColorStop(1, shade(p.bg, -0.3));
  rr(ctx, 30, 24, W - 60, 46, 11); ctx.fillStyle = tp; ctx.fill(); ctx.strokeStyle = fr[0]; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = fr[0]; for (const x of [40, W - 40]) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x + 5, 47); ctx.lineTo(x, 54); ctx.lineTo(x - 5, 47); ctx.fill(); }
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = p.ink;
  fit(ctx, name.toUpperCase(), W - 130, (s) => `700 ${s}px Cinzel`, 23, 13);
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4; ctx.fillText(name.toUpperCase(), W / 2, 48.5); ctx.shadowBlur = 0;
  // illustration
  const A = { x: AX, y: AY, w: AW, h: AH };
  ctx.save(); rr(ctx, AX, AY, AW, AH, 8); ctx.clip();
  (M[motif] || M.mountains)(ctx, p, A, r);
  // vignette + glowing edge
  const vg = ctx.createRadialGradient(AX + AW / 2, AY + AH / 2, AH * 0.35, AX + AW / 2, AY + AH / 2, AW * 0.75); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.45)"); ctx.fillStyle = vg; ctx.fillRect(AX, AY, AW, AH);
  ctx.restore();
  ctx.strokeStyle = fr[0]; ctx.lineWidth = 2.2; rr(ctx, AX, AY, AW, AH, 8); ctx.stroke(); ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.lineWidth = 1; rr(ctx, AX - 1.5, AY - 1.5, AW + 3, AH + 3, 9); ctx.stroke();
  // type ribbon
  const ry = AY + AH + 10;
  const rg = ctx.createLinearGradient(0, ry, 0, ry + 26); rg.addColorStop(0, shade(p.bg, 0.3)); rg.addColorStop(1, shade(p.bg, -0.2));
  rr(ctx, 56, ry, W - 112, 26, 13); ctx.fillStyle = rg; ctx.fill(); ctx.strokeStyle = fr[0]; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = fr[0]; fit(ctx, `${type} · ${subtitle}`.toUpperCase(), W - 150, (s) => `600 ${s}px Cinzel`, 12.5, 9); ctx.fillText(`${type} · ${subtitle}`.toUpperCase(), W / 2, ry + 13.5);
  // text box
  const ty = ry + 38, th = 600 - ty;
  const tg = ctx.createLinearGradient(0, ty, 0, ty + th); tg.addColorStop(0, "rgba(255,255,255,0.09)"); tg.addColorStop(1, "rgba(0,0,0,0.25)");
  rr(ctx, 34, ty, W - 68, th, 10); ctx.fillStyle = tg; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = p.ink; ctx.globalAlpha = 0.92;
  let fs = 17, lines;
  for (; fs >= 12; fs -= 1) { ctx.font = `italic 400 ${fs}px Inter`; lines = wrapLines(ctx, `“${flavor}”`, W - 110); if (lines.length * fs * 1.35 <= th - (stats ? 46 : 22)) break; }
  const lh = fs * 1.35, y0 = ty + (th - (stats ? 30 : 0)) / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh)); ctx.globalAlpha = 1;
  // stats
  if (stats) {
    [[stats.power, "POW", 60], [stats.ardor, "ARD", W - 60]].forEach(([v, lab, x]) => {
      const y = ty + th - 22; ctx.fillStyle = shade(p.bg, -0.45); ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fill(); ctx.strokeStyle = fr[0]; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = p.ink; ctx.font = "700 17px Cinzel"; ctx.fillText(String(v), x, y + 1); ctx.fillStyle = fr[0]; ctx.font = "600 7px Cinzel"; ctx.fillText(lab, x, y + 24 - 3);
    });
  }
  // card footer
  const fy = 626;
  ctx.fillStyle = fr[0]; ctx.textAlign = "left"; ctx.font = "600 10.5px Cinzel"; ctx.fillText(set.name.toUpperCase(), 38, fy);
  ctx.textAlign = "center"; ctx.fillStyle = p.ink; ctx.globalAlpha = 0.75; ctx.font = "500 10.5px Inter"; ctx.fillText(`${String(number).padStart(3, "0")}/${total}`, W / 2, fy); ctx.globalAlpha = 1;
  ctx.textAlign = "right";
  for (let i = 0; i < GEMS[rarity]; i++) { const x = W - 40 - i * 13; ctx.fillStyle = fr[0]; ctx.beginPath(); ctx.moveTo(x, fy - 5); ctx.lineTo(x + 4.5, fy); ctx.lineTo(x, fy + 5); ctx.lineTo(x - 4.5, fy); ctx.fill(); }
  // corner ornaments
  if (GEMS[rarity] >= 3) for (const [x, y] of [[26, 94], [W - 26, 94], [26, 586], [W - 26, 586]]) { ctx.fillStyle = fr[0]; ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.fill(); }
  return cv.toBuffer("image/png");
}

// ---------------------------------------------------------------- data
const cards = [], sets = [];
let defs = [];
for (const sid of Object.keys(SETS)) {
  const list = CARDS[sid];
  list.forEach(([name, type, motif, flavor], i) => defs.push({ sid, name, type, motif, flavor, number: i + 1, slug: slugify(name) }));
}
// rarities: fixed legendaries first, then quotas by hash rank
const QUOTA = { secret: 1, ultra: 3, holo: 7, rare: 16, uncommon: 31, common: 62 };
const taken = {};
for (const d of defs) if (LEGENDARY[d.name]) { d.rarity = LEGENDARY[d.name]; taken[d.rarity] = (taken[d.rarity] || 0) + 1; }
const free = defs.filter((d) => !d.rarity).sort((a, b) => hash32("rar:" + a.sid + a.slug) - hash32("rar:" + b.sid + b.slug));
let k = 0;
for (const [rar, q] of Object.entries(QUOTA)) for (let n = (taken[rar] || 0); n < q; n++) free[k++].rarity = rar;
if (k !== free.length) throw new Error("inconsistent quotas " + k + "/" + free.length);
const slugSeen = new Set();
for (const d of defs) { const key = d.sid + d.slug; if (slugSeen.has(key)) throw new Error("duplicate slug " + key); slugSeen.add(key); }

const total = (sid) => String(CARDS[sid].length).padStart(3, "0");
for (const d of defs) {
  const set = SETS[d.sid], id = `${THEME}:${d.sid}:${d.slug}`;
  d.id = id; d.set = set; d.total = total(d.sid);
  d.palName = set.pals[hash32("pal" + id) % set.pals.length];
  d.subtitle = SUBTITLE[d.sid][d.type];
  if (d.type === "Creature" || d.type === "Ally") {
    const base = { common: 2, uncommon: 3, rare: 4, holo: 5, ultra: 6, secret: 7 }[d.rarity];
    d.stats = { power: base + (hash32("p" + id) % 3), ardor: Math.max(1, base - 1 + (hash32("a" + id) % 3)) };
  }
  const c = { id, theme: THEME, set: d.sid, number: d.number, name: d.name, subtitle: d.subtitle, type: d.type, rarity: d.rarity,
    foil: foilFor(d.rarity, id), image: `/cards/${DECK}/${d.sid}/${d.slug}.webp`, thumb: `/cards/${DECK}/${d.sid}/${d.slug}.thumb.webp`,
    art_rect: [...ART], flavor: d.flavor, artist: "Procedural illustration" };
  if (d.stats) c.stats = d.stats;
  cards.push(c);
}

if (!flag("--dry")) {
  for (const d of defs) {
    if (only && d.slug !== only) continue;
    const dir = path.join(OUT, d.sid); fs.mkdirSync(dir, { recursive: true });
    const o1 = path.join(dir, d.slug + ".webp"), o2 = path.join(dir, d.slug + ".thumb.webp");
    if (!flag("--force") && !only && fs.existsSync(o1) && fs.existsSync(o2)) continue;
    const png = drawCard(d);
    fs.writeFileSync(o1, (await webp(png, 480, 672, { q: 80, maxKB: 60 })).buf);
    fs.writeFileSync(o2, (await webp(png, 240, 336, { q: 76, maxKB: 18 })).buf);
  }
}
for (const sid of Object.keys(SETS)) {
  const s = SETS[sid]; fs.mkdirSync(path.join(OUT, sid), { recursive: true });
  if (!flag("--dry")) fs.writeFileSync(path.join(OUT, sid, "pack.webp"), await makePack({ title: s.name, kicker: "Embers & Peaks", accent: s.accent, emblem: s.emblem, seed: "ember" + sid }));
  sets.push({ id: sid, theme: THEME, name: s.name, card_count: CARDS[sid].length, accent: s.accent, cover: `/cards/${DECK}/${sid}/pack.webp` });
}
writeJson(path.join(ROOT, `content/cards/${THEME}.json`), { theme: THEME, sets, cards, pack: PACK });
const tally = {}; for (const c of cards) { tally[c.set] ??= {}; tally[c.set][c.rarity] = (tally[c.set][c.rarity] || 0) + 1; }
console.log(`${THEME} (${DECK}):`, cards.length, "cards"); console.table(tally);
