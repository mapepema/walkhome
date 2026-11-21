import { MapPin } from "lucide-react"
import { useStore, selUnits } from "@/lib/store"
import { fmtNum, unitLabel, fmtDist } from "@/lib/format"
import { Bar } from "@/kit/ui"

/** The camp: where you are on the route. A quiet gradient from the biome palette, big numerals. */
export function Hero() {
  const subject = useStore((s) => s.snap?.subject)
  const journey = useStore((s) => s.journey)
  const units = useStore(selUnits)
  if (!subject || !journey) return <div className="skeleton h-[280px] lg:h-[340px]" />
  const p = subject.biome?.palette
  const bg = p
    ? `linear-gradient(165deg, color-mix(in oklab, ${p.sky[0]} 34%, #0b0b0c), color-mix(in oklab, ${p.far} 20%, #0b0b0c) 62%, #0b0b0c)`
    : undefined
  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/8 p-6 lg:p-9" style={{ background: bg }} aria-label="Your position on the road">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-white/65"><MapPin className="size-3.5" strokeWidth={2} /> {subject.stage?.name}</div>
      <h1 className="font-display mt-2 max-w-[22ch] text-[30px] leading-[1.1] text-white lg:text-[44px]">{subject.biome?.name}</h1>
      <div className="mt-10 flex items-end gap-2 lg:mt-14">
        <span className="tnum text-[56px] font-semibold leading-none tracking-tight text-white lg:text-[84px]">{fmtNum(subject.progress_m, units, 1)}</span>
        <span className="pb-1.5 text-lg font-medium text-white/55 lg:pb-3 lg:text-2xl">{unitLabel(units)}</span>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Bar value={subject.fraction} height={5} className="flex-1 bg-white/15" />
        <span className="tnum shrink-0 text-xs font-medium text-white/60">{(subject.fraction * 100).toFixed(1)}% of {fmtDist(journey.total_m, units, 0)}</span>
      </div>
    </section>
  )
}
