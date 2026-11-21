import { useMemo } from "react"
import { Flag } from "lucide-react"
import { QuestMap } from "@/components/QuestMap"
import { selUnits, useStore } from "@/lib/store"
import { fmtDist } from "@/lib/format"
import { Bar } from "@/kit/ui"

/** Desktop only: under the scene, where you are on the whole route. */
export function RoadAhead() {
  const journey = useStore((s) => s.journey)
  const me = useStore((s) => s.me)
  const progress = useStore((s) => s.snap?.session?.progress_m ?? s.snap?.subject.progress_m ?? 0)
  const units = useStore(selUnits)
  const markers = useMemo(() => (journey && me ? [{ fraction: Math.round(progress / 50) * 50 / journey.total_m, avatar: me.avatar, color: me.color, me: true }] : []), [journey, me, progress])
  const upcoming = useMemo(() => journey?.events.filter((e) => e.kind === "milestone" && e.at_m > progress).slice(0, 3) ?? [], [journey, progress])
  if (!journey) return null
  return (
    <div className="glass hidden items-stretch gap-5 overflow-hidden p-4 lg:flex">
      <div className="flex w-[300px] shrink-0 items-center"><QuestMap journey={journey} markers={markers} className="w-full rounded-2xl" /></div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
        <div className="text-sm font-semibold">On the road</div>
        <Bar value={progress / journey.total_m} height={6} />
        {upcoming.map((e) => (
          <div key={e.id} className="flex items-center gap-2.5 text-sm"><Flag className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} /><span className="min-w-0 flex-1 truncate">{e.title}</span><span className="tnum text-xs font-semibold text-gold">{fmtDist(e.at_m - progress, units)}</span></div>
        ))}
      </div>
    </div>
  )
}
