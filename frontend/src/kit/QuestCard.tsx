import { useState } from "react"
import { motion } from "framer-motion"
import { Check, Gem, Gift, Layers, Loader2 } from "lucide-react"
import { QuestGlyph } from "./icons"
import { post, errMsg } from "@/lib/api"
import { useStore, selUnits } from "@/lib/store"
import { fmtDist, fmtDur } from "@/lib/format"
import { confettiBurst } from "@/lib/fx"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"
import type { PackGrant, Quest } from "@/lib/types"
import { Bar, Chip } from "./ui"
import { toast } from "sonner"

export function useQuestProgressText() {
  const units = useStore(selUnits)
  return (q: Quest, v: number) => {
    switch (q.unit) {
      case "m": return fmtDist(v, units, v >= 1000 ? 1 : 0)
      case "s": return fmtDur(v)
      case "days": return `${Math.floor(v)} j`
      default: return String(Math.floor(v))
    }
  }
}

export function RewardChips({ reward }: { reward: Quest["reward"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {reward.packs ? <Chip><Layers className="size-3" /> {reward.packs} pack{reward.packs > 1 ? "s" : ""}</Chip> : null}
      {reward.essence ? <Chip><Gem className="size-3" /> {reward.essence} essence</Chip> : null}
    </div>
  )
}

/** Claim hook: server grants, we celebrate. */
export function useClaim(onDone?: () => void) {
  const refresh = useStore((s) => s.refresh)
  const bump = useStore((s) => s.bump)
  const [busy, setBusy] = useState<string | null>(null)
  const claim = async (q: Quest) => {
    setBusy(q.id)
    try {
      const r = await post<{ granted: PackGrant[]; essence: number; essence_gained?: number }>(`/me/quests/${q.id}/claim`)
      haptic.reward()
      confettiBurst(["#fff3c4", "#e3b45c", "#ffffff"], { big: !!r.granted.length })
      toast.success(`${q.title} — reward claimed`, { description: [r.granted.length ? `${r.granted.length} pack(s)` : "", (r.essence_gained ?? 0) ? `+${r.essence_gained} essence` : ""].filter(Boolean).join(" · ") })
      await refresh()
      bump()
      onDone?.()
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }
  return { claim, busy }
}

const PERIOD: Record<Quest["period"], string> = { daily: "Daily", weekly: "Weekly", story: "Story" }

export function QuestCard({ q, busy, onClaim, className }: { q: Quest; busy?: boolean; onClaim: (q: Quest) => void; className?: string }) {
  const txt = useQuestProgressText()
  const pct = Math.min(1, q.target ? q.progress / q.target : 0)
  const done = q.claimed
  return (
    <motion.article
      layout
      className={cn("glass relative flex flex-col gap-3 p-4", q.claimable && "glass-hi", done && "opacity-60", className)}
    >
            <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/8 text-foreground">{done ? <Check className="size-5 text-emerald-400" strokeWidth={2.4} /> : <QuestGlyph q={q} className="size-5" />}</div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">{PERIOD[q.period]}</div>
          <h3 className="mt-0.5 text-[16px] font-semibold leading-snug tracking-tight">{q.title}</h3>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{q.description}</p>
        </div>
      </div>
      <div>
        <Bar value={pct} />
        <div className="tnum mt-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>{txt(q, Math.min(q.progress, q.target))} / {txt(q, q.target)}</span>
          <span>{Math.round(pct * 100)}%</span>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <RewardChips reward={q.reward} />
        {q.claimable ? (
          <button onClick={() => onClaim(q)} disabled={busy} className="btn-gold flex items-center gap-1.5 rounded-full px-4 py-2 text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Gift className="size-3.5" />} Claim
          </button>
        ) : done ? (
          <span className="text-xs font-semibold text-emerald-400">Claimed</span>
        ) : null}
      </div>
    </motion.article>
  )
}
