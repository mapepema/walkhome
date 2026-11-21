import { useMemo } from "react"
import { Flag } from "lucide-react"
import { useStore, selUnits } from "@/lib/store"
import { fmtDist } from "@/lib/format"
import { Bar, Panel } from "@/kit/ui"

export function MilestoneCard() {
  const subject = useStore((s) => s.snap?.subject)
  const journey = useStore((s) => s.journey)
  const units = useStore(selUnits)
  const prev = useMemo(() => {
    if (!subject || !journey) return null
    return [...journey.events].reverse().find((e) => e.kind === "milestone" && e.at_m <= subject.progress_m) ?? null
  }, [subject, journey])
  if (!subject || !journey) return null
  const next = subject.next_milestone
  if (!next)
    return <Panel className="p-5 text-center"><Flag className="mx-auto size-7 text-gold" /><div className="mt-2 font-semibold">Quest complete</div></Panel>
  const from = prev?.at_m ?? 0
  const frac = Math.min(1, Math.max(0, (subject.progress_m - from) / Math.max(1, next.at_m - from)))
  const eta = subject.eta_days_to_milestone
  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-gold"><Flag className="size-5" strokeWidth={1.8} /></div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Next milestone</div>
          <h3 className="mt-0.5 truncate text-[17px] font-semibold tracking-tight">{next.title}</h3>
        </div>
        <div className="text-right">
          <div className="tnum text-xl font-semibold">{fmtDist(subject.next_milestone_in_m, units)}</div>
          {eta != null && <div className="text-[11px] text-muted-foreground">≈ {eta < 1 ? "tomorrow" : `${Math.ceil(eta)} d`} at your pace</div>}
        </div>
      </div>
      <div className="mt-4">
        <Bar value={frac} />
        <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span className="truncate">{prev?.title ?? "Start"}</span>
          <span className="tnum shrink-0 pl-2">{Math.round(frac * 100)}%</span>
        </div>
      </div>
    </Panel>
  )
}
