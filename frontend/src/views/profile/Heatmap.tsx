import { useEffect, useMemo, useRef, useState } from "react"
import { dayKey } from "@/lib/format"
import { fmtDist } from "@/lib/format"
import type { DailyRow, Units } from "@/lib/types"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Calendar heatmap, weeks as columns (Mon-first), intensity relative to the daily goal. */
export function Heatmap({ daily, goalM, units }: { daily: DailyRow[]; goalM: number; units: Units }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(360)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // phone: 26 weeks scrolled to today; desktop: as many weeks as fit (max a year)
  const weeks = width >= 700 ? Math.min(53, Math.max(26, Math.floor((width - 28) / 17))) : 26
  const cells = useMemo(() => {
    const map = new Map(daily.map((d) => [d.day, d.distance_m]))
    const end = new Date()
    const dow = (end.getDay() + 6) % 7
    const start = new Date(end)
    start.setDate(end.getDate() - dow - (weeks - 1) * 7)
    const cols: { key: string; m: number; future: boolean; date: Date }[][] = []
    for (let w = 0; w < weeks; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start)
        date.setDate(start.getDate() + w * 7 + d)
        const key = dayKey(date)
        col.push({ key, m: map.get(key) ?? 0, future: date > end, date })
      }
      cols.push(col)
    }
    return cols
  }, [daily, weeks])
  useEffect(() => { ref.current?.scrollTo({ left: 9999 }) }, [cells])
  const level = (m: number) => (m <= 0 ? 0 : m < goalM * 0.5 ? 1 : m < goalM ? 2 : m < goalM * 1.6 ? 3 : 4)
  const bg = (l: number) => (l === 0 ? "oklch(1 0 0 / 5%)" : `color-mix(in oklab, var(--th-accent) ${[0, 28, 50, 76, 100][l]}%, transparent)`)
  return (
    <div>
      <div ref={ref} className="overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        <div className="inline-flex gap-[3px]" role="img" aria-label="Walk calendar">
          <div className="mr-1 flex flex-col gap-[3px] pt-[18px] text-[9px] text-muted-foreground">
            {["L", "", "M", "", "V", "", "D"].map((d, i) => <span key={i} className="h-[14px] leading-[14px]">{d}</span>)}
          </div>
          {cells.map((col, i) => {
            const first = col[0].date
            const label = first.getDate() <= 7 ? MONTHS[first.getMonth()] : ""
            return (
              <div key={i} className="flex flex-col gap-[3px]">
                <span className="h-[15px] text-[9px] leading-[15px] text-muted-foreground">{label}</span>
                {col.map((c) => (
                  <span
                    key={c.key}
                    title={`${c.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} — ${c.m ? fmtDist(c.m, units, 2) : "rest day"}`}
                    className="size-[14px] rounded-[4px]"
                    style={{ background: c.future ? "transparent" : bg(level(c.m)), boxShadow: level(c.m) >= 3 ? "0 0 8px var(--th-glow)" : undefined }}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        less {[0, 1, 2, 3, 4].map((l) => <span key={l} className="size-[11px] rounded-[3px]" style={{ background: bg(l) }} />)} more
      </div>
    </div>
  )
}
