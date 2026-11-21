import type { Rarity } from "../types"

/** WebAudio-synthesised sounds (no assets). Mutable, remembered in localStorage. */
let ctx: AudioContext | null = null
const KEY = "wh-tcg-sound"

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0"
  } catch {
    return true
  }
}
export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0")
  } catch {
    /* ignore */
  }
}

function ac(): AudioContext | null {
  if (!soundEnabled()) return null
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx ??= new AC()
    if (ctx.state === "suspended") void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function noise(a: AudioContext, dur: number) {
  const buf = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  src.buffer = buf
  return src
}

function tone(a: AudioContext, freq: number, t0: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(a.destination)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

/** Tear: filtered noise whose grain rises with the progress. */
export function sfxTear() {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const n = noise(a, 0.45)
  const f = a.createBiquadFilter()
  f.type = "bandpass"
  f.frequency.setValueAtTime(1200, t)
  f.frequency.exponentialRampToValueAtTime(5200, t + 0.4)
  f.Q.value = 0.8
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.05)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
  n.connect(f).connect(g).connect(a.destination)
  n.start(t)
}

export function sfxFlip() {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const n = noise(a, 0.18)
  const f = a.createBiquadFilter()
  f.type = "highpass"
  f.frequency.value = 2400
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.04)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  n.connect(f).connect(g).connect(a.destination)
  n.start(t)
}

const SCALE = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98, 2093]

/** Chime that gets longer and brighter as rarity goes up. */
export function sfxReveal(r: Rarity) {
  const a = ac()
  if (!a) return
  const t = a.currentTime
  const steps = { common: 1, uncommon: 2, rare: 3, holo: 4, ultra: 6, secret: 7 }[r]
  for (let i = 0; i < steps; i++) tone(a, SCALE[i], t + i * 0.075, 0.5 + i * 0.05, 0.1 + i * 0.01, i % 2 ? "triangle" : "sine")
  if (r === "ultra" || r === "secret") {
    tone(a, 130.8, t, 1.2, 0.22, "sawtooth")
    tone(a, 196, t + 0.05, 1.1, 0.12, "triangle")
  }
  if (r === "secret") for (let i = 0; i < 8; i++) tone(a, 1800 + i * 310, t + 0.5 + i * 0.06, 0.6, 0.05)
}

export function haptic(r: Rarity | "tick") {
  const v = navigator.vibrate?.bind(navigator)
  if (!v) return
  const pat: Record<string, number | number[]> = {
    tick: 8,
    common: 8,
    uncommon: 14,
    rare: 24,
    holo: [30, 40, 30],
    ultra: [40, 30, 40, 30, 90],
    secret: [60, 40, 60, 40, 60, 40, 180],
  }
  v(pat[r])
}
