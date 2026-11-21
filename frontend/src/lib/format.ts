import type { Units } from "./types"

const MI = 1609.344

export function fmtDist(
  m: number | null | undefined,
  units: Units,
  digits = 1,
): string {
  if (m == null) return "—"
  if (units === "mi") return `${(m / MI).toFixed(digits)} mi`
  return `${(m / 1000).toFixed(digits)} km`
}

export function fmtSpeed(kmh: number | null | undefined, units: Units): string {
  if (kmh == null) return "—"
  if (units === "mi") return `${(kmh / 1.609344).toFixed(1)} mph`
  return `${kmh.toFixed(1)} km/h`
}

export function fmtDur(s: number | null | undefined): string {
  const total = Math.max(0, Math.round(s ?? 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`
}

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return ""
  const locale = "en-GB"
  const d = new Date(iso)
  return (
    d.toLocaleDateString(locale, { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
  )
}

export function toUnit(m: number, units: Units): number {
  return units === "mi" ? m / MI : m / 1000
}

export function fromUnit(v: number, units: Units): number {
  return units === "mi" ? v * MI : v * 1000
}

export function fmtAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** Distance without the unit suffix, in the user's unit. */
export function fmtNum(m: number, units: Units, digits = 1): string {
  return (units === "mi" ? m / MI : m / 1000).toFixed(digits)
}

export function unitLabel(units: Units): string {
  return units === "mi" ? "mi" : "km"
}

/** m/s-free pace: minutes per km (or mile) as m'ss". */
export function fmtPace(speedKmh: number | null | undefined, units: Units): string {
  if (!speedKmh || speedKmh < 0.5) return "—"
  const perUnit = units === "mi" ? 60 / (speedKmh / 1.609344) : 60 / speedKmh
  const min = Math.floor(perUnit)
  const sec = Math.round((perUnit - min) * 60)
  return `${min}'${String(sec === 60 ? 59 : sec).padStart(2, "0")}"`
}

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`
}

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}
