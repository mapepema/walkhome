import { Zap } from "lucide-react"
import { Bar } from "@/kit/ui"
import type { ChallengeSnap } from "@/lib/types"

export function ChallengePanel({ c }: { c: ChallengeSnap }) {
  if (c.state !== "running") return null
  return (
    <div className="rounded-2xl bg-white/8 p-4" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--th-accent)] text-[var(--th-accent-fg)]"><Zap className="size-5" strokeWidth={2} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-white/55">Challenge in progress</div>
          <div className="truncate text-[15px] font-semibold text-white">{c.title}</div>
          <div className="text-[13px] text-white/70">{c.target}{c.fallback_used ? " *" : ""}</div>
        </div>
        <div className="tnum text-right"><div className="text-2xl font-semibold text-white">{Math.round(c.remaining_s)}</div><div className="text-[11px] text-white/50">sec</div></div>
      </div>
      <Bar value={c.progress} className="mt-3 bg-white/15" height={6} />
    </div>
  )
}
