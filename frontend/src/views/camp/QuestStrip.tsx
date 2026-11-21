import { ChevronRight } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { href } from "@/lib/router"
import type { Quest } from "@/lib/types"
import { QuestCard, useClaim } from "@/kit/QuestCard"
import { SectionHead, Skeleton } from "@/kit/ui"

export function QuestStrip() {
  const { data, reload } = useApi<Quest[]>("/me/quests")
  const { claim, busy } = useClaim(reload)
  const list = (data ?? []).filter((q) => q.period !== "story" || q.claimable).filter((q) => !q.claimed)
  const sorted = [...list].sort((a, b) => Number(b.claimable) - Number(a.claimable))
  return (
    <section aria-label="Today's quests">
      <SectionHead title="Today's quests" action={<a href={href("quests")} className="flex items-center text-sm font-medium text-gold">See all <ChevronRight className="size-4" /></a>} />
      {!data ? (
        <div className="snap-x-row"><Skeleton className="h-[180px] w-[260px]" /><Skeleton className="h-[180px] w-[260px]" /></div>
      ) : sorted.length === 0 ? (
        <div className="glass p-5 text-center text-sm text-muted-foreground">All quests are done. Come back tomorrow.</div>
      ) : (
        <div className="snap-x-row -mx-4 px-4 pb-1 lg:mx-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:px-0">
          {sorted.slice(0, 6).map((q) => (
            <QuestCard key={q.id} q={q} busy={busy === q.id} onClaim={claim} className="w-[268px] lg:w-auto" />
          ))}
        </div>
      )}
    </section>
  )
}
