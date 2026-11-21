import { useMemo, useState } from "react"
import { fmtNum, fmtPace, unitLabel } from "@/lib/format"
import type { DailyRow, SessionRow, Units } from "@/lib/types"

function mondayKey(d: Date) {
  const x = new Date(d)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

const W = 560
const H = 170
const PAD = { l: 34, r: 8, t: 20, b: 24 }

export function WeeklyBars({ daily, units, weeks = 12 }: { daily: DailyRow[]; units: Units; weeks?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = useMemo(() => {
    const now = mondayKey(new Date())
    const out = Array.from({ length: weeks }, (_, i) => ({ t: now - (weeks - 1 - i) * 7 * 864e5, m: 0 }))
    for (const d of daily) {
      const k = mondayKey(new Date(d.day + "T12:00:00"))
      const row = out.find((o) => Math.abs(o.t - k) < 36e5 * 13)
      if (row) row.m += d.distance_m
    }
    return out
  }, [daily, weeks])
  const max = Math.max(1000, ...data.map((d) => d.m))
  const unitMax = Math.ceil((units === "mi" ? max / 1609.344 : max / 1000) / 5) * 5 || 5
  const bw = (W - PAD.l - PAD.r) / weeks
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (units === "mi" ? v / 1609.344 : v / 1000) / unitMax)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Distance per week">
      <defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--th-accent)" /><stop offset="1" stopColor="var(--th-accent-2)" /></linearGradient></defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * (1 - f)} y2={PAD.t + (H - PAD.t - PAD.b) * (1 - f)} stroke="white" strokeOpacity={0.08} />
          <text x={PAD.l - 6} y={PAD.t + (H - PAD.t - PAD.b) * (1 - f) + 3} textAnchor="end" fontSize={9} fill="white" fillOpacity={0.5}>{Math.round(unitMax * f)}</text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = PAD.l + i * bw + bw * 0.16
        const h = Math.max(2, H - PAD.b - y(d.m))
        const dt = new Date(d.t)
        return (
          <g key={d.t} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
            <rect x={x} y={H - PAD.b - h} width={bw * 0.68} height={h} rx={4} fill={d.m ? "url(#barg)" : "white"} fillOpacity={d.m ? (hover === i ? 1 : 0.85) : 0.06} />
            {(i % 2 === 0 || weeks <= 8) && <text x={x + bw * 0.34} y={H - 8} textAnchor="middle" fontSize={9} fill="white" fillOpacity={0.5}>{dt.getDate()}/{dt.getMonth() + 1}</text>}
            {hover === i && d.m > 0 && <text x={x + bw * 0.34} y={H - PAD.b - h - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--th-accent)">{fmtNum(d.m, units, 1)} {unitLabel(units)}</text>}
          </g>
        )
      })}
    </svg>
  )
}

export function PaceLine({ sessions, units }: { sessions: SessionRow[]; units: Units }) {
  const pts = useMemo(() => sessions.filter((s) => s.moving_s > 120 && s.distance_m > 300 && s.source !== "manual").slice(0, 24).reverse().map((s) => ({ kmh: (s.distance_m / 1000) / (s.moving_s / 3600), t: s.start_utc })), [sessions])
  if (pts.length < 2) return <p className="py-8 text-center text-sm text-muted-foreground">Not enough walks yet to chart your pace.</p>
  const lo = Math.floor(Math.min(...pts.map((p) => p.kmh)) - 0.3)
  const hi = Math.ceil(Math.max(...pts.map((p) => p.kmh)) + 0.3)
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (pts.length - 1)
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo))
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.kmh).toFixed(1)}`).join(" ")
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average pace per walk">
      <defs><linearGradient id="pacefill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--th-accent)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--th-accent)" stopOpacity={0} /></linearGradient></defs>
      {[lo, (lo + hi) / 2, hi].map((v) => (
        <g key={v}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="white" strokeOpacity={0.08} /><text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="white" fillOpacity={0.5}>{v.toFixed(1)}</text></g>
      ))}
      <path d={`${line} L${x(pts.length - 1)} ${H - PAD.b} L${x(0)} ${H - PAD.b} Z`} fill="url(#pacefill)" />
      <path d={line} fill="none" stroke="var(--th-accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.kmh)} r={i === pts.length - 1 ? 5 : 2.5} fill={i === pts.length - 1 ? "var(--th-accent)" : "var(--th-bg)"} stroke="var(--th-accent)" strokeWidth={1.5} />)}
      <text x={W - PAD.r} y={9} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--th-accent)">latest: {last.kmh.toFixed(1)} km/h · {fmtPace(last.kmh, units)}/{unitLabel(units)}</text>
    </svg>
  )
}
