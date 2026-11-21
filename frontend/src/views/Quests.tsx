import { useMemo, useState } from "react"
import { AnimatePresence } from "framer-motion"
import { Check, Flag, ScrollText } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { selUnits, useStore } from "@/lib/store"
import { fmtDist } from "@/lib/format"
import type { Quest } from "@/lib/types"
import { QuestCard, useClaim } from "@/kit/QuestCard"
import { EmptyState, PageTitle, Panel, SectionHead, Segmented, Skeleton } from "@/kit/ui"
import { cn } from "@/lib/utils"

type Tab = "daily" | "weekly" | "story"
const LABEL: Record<Tab, string> = { daily: "Daily", weekly: "Weekly", story: "Story" }

function resetIn(q?: Quest) {
  if (!q?.expires_utc) return null
  const h = Math.max(0, (new Date(q.expires_utc).getTime() - Date.now()) / 36e5)
  return h >= 24 ? `${Math.floor(h / 24)} j ${Math.floor(h % 24)} h` : `${Math.floor(h)} h ${Math.floor((h % 1) * 60)} min`
}

function Milestones() {
  const journey = useStore((s) => s.journey)
  const progress = useStore((s) => s.snap?.subject.progress_m ?? 0)
  const units = useStore(selUnits)
  const list = useMemo(() => journey?.events.filter((e) => e.kind === "milestone") ?? [], [journey])
  const nextIdx = list.findIndex((e) => e.at_m > progress)
  // show a window around the current position
  const from = Math.max(0, (nextIdx < 0 ? list.length : nextIdx) - 4)
  const shown = list.slice(from, from + 12)
  return (
    <Panel className="p-5">
      <SectionHead title="Road milestones" action={<span className="tnum text-xs text-muted-foreground">{Math.max(0, nextIdx < 0 ? list.length : nextIdx)}/{list.length}</span>} />
      <ol className="relative ml-3.5 border-l border-[var(--line)] pl-6">
        {shown.map((e) => {
          const done = e.at_m <= progress
          const isNext = list[nextIdx]?.id === e.id
          return (
            <li key={e.id} className="relative pb-5 last:pb-0">
              <span className={cn("absolute -left-[calc(1.5rem+0.9rem+0.5px)] flex size-[1.8rem] items-center justify-center rounded-full border text-sm", done ? "border-transparent bg-[var(--th-accent)] text-[var(--th-accent-fg)]" : isNext ? "border-[var(--th-accent)] bg-[var(--th-bg-2)] animate-pulse-ring" : "border-[var(--line)] bg-[var(--th-bg-2)] opacity-70")}>
                {done ? <Check className="size-3.5" strokeWidth={3} /> : <Flag className="size-3.5" />}
              </span>
              <div className={cn("text-sm font-semibold", !done && !isNext && "text-muted-foreground")}>{e.title}</div>
              <div className="tnum text-xs text-muted-foreground">{done ? "Reached" : `in ${fmtDist(e.at_m - progress, units)}`} · km {fmtDist(e.at_m, units, 0).replace(/\s?km|\s?mi/, "")}</div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}

export function Quests() {
  const { data, reload } = useApi<Quest[]>("/me/quests")
  const { claim, busy } = useClaim(reload)
  const [tab, setTab] = useState<Tab>("daily")
  const claimable = data?.filter((q) => q.claimable).length ?? 0
  const list = (data ?? []).filter((q) => q.period === tab).sort((a, b) => Number(b.claimable) - Number(a.claimable) || Number(a.claimed) - Number(b.claimed))
  return (
    <div>
      <PageTitle title="Quests" sub={claimable ? `${claimable} reward${claimable > 1 ? "s" : ""} to claim` : "Complete them to earn packs and essence"} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Segmented value={tab} onChange={setTab} options={(Object.keys(LABEL) as Tab[]).map((k) => ({ value: k, label: LABEL[k] }))} />
            {resetIn(list[0]) && <span className="text-xs text-muted-foreground">Ends in <b className="tnum text-foreground">{resetIn(list[0])}</b></span>}
          </div>
          {!data ? (
            <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[190px]" />)}</div>
          ) : list.length === 0 ? (
            <Panel><EmptyState icon={<ScrollText className="size-7 text-gold" />} title="No quests here" body="New quests are coming soon." /></Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <AnimatePresence initial={false}>
                {list.map((q) => <QuestCard key={q.id} q={q} busy={busy === q.id} onClaim={claim} />)}
              </AnimatePresence>
            </div>
          )}
        </div>
        <Milestones />
      </div>
    </div>
  )
}
