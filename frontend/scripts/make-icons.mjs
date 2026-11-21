// Generates PWA icons (any + maskable + shortcuts) from an inline SVG: node scripts/make-icons.mjs
import sharp from "sharp"
const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="32%" r="80%"><stop offset="0" stop-color="#2a2013"/><stop offset="1" stop-color="#0d0b09"/></radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbe7b0"/><stop offset=".5" stop-color="#e3b45c"/><stop offset="1" stop-color="#b9852f"/></linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${pad}) translate(-256 -256)">
    <path d="M70 380 L190 190 L250 280 L310 170 L442 380 Z" fill="url(#g)" opacity=".95"/>
    <path d="M70 380 L442 380" stroke="#fbe7b0" stroke-width="10" stroke-linecap="round"/>
    <circle cx="372" cy="128" r="30" fill="url(#g)"/>
    <path d="M256 420 q-26 0-26 32 t26 32 q26 0 26-32 t-26-32z" fill="none"/>
  </g>
</svg>`
const out = "public/icons"
for (const [name, size, pad] of [["icon-192", 192, 1], ["icon-512", 512, 1], ["icon-180", 180, 1], ["icon-maskable-512", 512, 0.72]]) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(`${out}/${name}.png`)
}
console.log("icons written")
