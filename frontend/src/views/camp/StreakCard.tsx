import { useMemo } from "react"
import { Check, Flame } from "lucide-react"
import { useApi } from "@/lib/hooks"
import type { DailyRow, Streak } from "@/lib/types"
import { dayKey } from "@/lib/format"
import { Panel } from "@/kit/ui"
import { cn } from "@/lib/utils"

const DOW = ["D", "L", "M", "M", "J", "V", "S"]

export function StreakCard() {
  const { data: streak } = useApi<Streak>("/me/streak")
  const { data: daily } = useApi<DailyRow[]>("/me/daily?days=7")
  const days = useMemo(() => {
    const set = new Set((daily ?? []).filter((d) => d.distance_m > 0).map((d) => d.day))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (6 - i))
      return { key: dayKey(d), dow: DOW[d.getDay()], done: set.has(dayKey(d)), today: i === 6 }
    })
  }, [daily])
  const n = streak?.days ?? 0
  return (
    <Panel className="p-5">
      <div className="flex items-center gap-4">
        <div className={cn("flex size-12 items-center justify-center rounded-full", n > 0 ? "bg-orange-500/15 text-orange-400" : "bg-white/8 text-muted-foreground")} aria-hidden><Flame className="size-6" strokeWidth={1.8} /></div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Streak</div>
          <div className="flex items-baseline gap-1.5"><span className="tnum text-3xl font-semibold tracking-tight">{n}</span><span className="text-sm text-muted-foreground">day{n > 1 ? "s" : ""} in a row</span></div>
          {streak?.best ? <div className="text-[11px] text-muted-foreground">Best: {streak.best} days</div> : null}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((d) => (
          <div key={d.key} className="flex flex-col items-center gap-1">
            <span className={cn("flex size-8 items-center justify-center rounded-full text-sm", d.done ? "btn-gold" : "bg-white/6", d.today && !d.done && "ring-1 ring-[var(--th-accent)]")}>{d.done ? <Check className="size-4" strokeWidth={2.6} /> : null}</span>
            <span className="text-[10px] text-muted-foreground">{d.dow}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
