import { useMemo } from "react"
import { Flame, Gauge, Mountain, Route, Trophy } from "lucide-react"
import { fmtDist, fmtDur } from "@/lib/format"
import type { DailyRow, SessionRow, Streak, Units } from "@/lib/types"

function Rec({ icon: I, label, value, sub }: { icon: typeof Trophy; label: string; value: string; sub?: string }) {
  return (
    <div className="glass flex items-center gap-3 p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--th-accent)_12%,transparent)]"><I className="size-[18px] text-gold" /></span>
      <div className="min-w-0"><div className="eyebrow">{label}</div><div className="tnum truncate text-[17px] font-bold">{value}</div>{sub && <div className="truncate text-[11px] text-muted-foreground">{sub}</div>}</div>
    </div>
  )
}

export function Records({ sessions, daily, streak, units }: { sessions: SessionRow[]; daily: DailyRow[]; streak: Streak | null; units: Units }) {
  const r = useMemo(() => {
    const total = sessions.reduce((a, s) => a + s.distance_m, 0)
    const longest = sessions.reduce<SessionRow | null>((b, s) => (!b || s.distance_m > b.distance_m ? s : b), null)
    const bestDay = daily.reduce<DailyRow | null>((b, d) => (!b || d.distance_m > b.distance_m ? d : b), null)
    const fastest = sessions.filter((s) => s.moving_s > 300 && s.source !== "manual").reduce<{ s: SessionRow; v: number } | null>((b, s) => {
      const v = s.distance_m / 1000 / (s.moving_s / 3600)
      return !b || v > b.v ? { s, v } : b
    }, null)
    return { total, longest, bestDay, fastest, count: sessions.length, time: sessions.reduce((a, s) => a + s.moving_s, 0) }
  }, [sessions, daily])
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Rec icon={Route} label="Total walked" value={fmtDist(r.total, units, 0)} sub={`${r.count} walks · ${fmtDur(r.time)}`} />
      <Rec icon={Mountain} label="Longest walk" value={r.longest ? fmtDist(r.longest.distance_m, units, 2) : "—"} sub={r.longest ? date(r.longest.start_utc) : undefined} />
      <Rec icon={Trophy} label="Best day" value={r.bestDay ? fmtDist(r.bestDay.distance_m, units, 2) : "—"} sub={r.bestDay ? date(r.bestDay.day + "T12:00:00") : undefined} />
      <Rec icon={Gauge} label="Top speed" value={r.fastest ? `${r.fastest.v.toFixed(1)} km/h` : "—"} sub={r.fastest ? date(r.fastest.s.start_utc) : undefined} />
      <Rec icon={Flame} label="Current streak" value={`${streak?.days ?? 0} d`} sub={streak?.best ? `Best ${streak.best} d` : undefined} />
      <Rec icon={Flame} label="Grace days" value={String(streak?.grace_used ?? 0)} sub="One missed day is forgiven" />
    </div>
  )
}
