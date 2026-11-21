import { Flag } from "lucide-react"
import { selUnits, useStore } from "@/lib/store"
import { fmtDist } from "@/lib/format"

/** Next milestone line (the pack progress lives in the dial). */
export function PackProgress({ progressM }: { progressM: number }) {
  const next = useStore((s) => s.snap?.session?.next_milestone)
  const units = useStore(selUnits)
  if (!next) return null
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/6 px-4 py-3.5 text-sm">
      <Flag className="size-4 shrink-0 text-white/60" strokeWidth={1.8} />
      <span className="min-w-0 flex-1 truncate text-white/85">{next.title}</span>
      <span className="tnum shrink-0 font-semibold text-white">{fmtDist(next.at_m - progressM, units)}</span>
    </div>
  )
}
