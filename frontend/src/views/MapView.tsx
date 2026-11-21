import { useState } from "react"
import { EventGlyph } from "@/kit/icons"
import { ScrollText } from "lucide-react"
import { QuestMap, type MapMarker } from "@/components/QuestMap"
import { useApi } from "@/lib/hooks"
import { fmtAgo, fmtDist } from "@/lib/format"
import { selUnits, useStore } from "@/lib/store"
import type { JournalEntry, Leaderboard } from "@/lib/types"
import { EmptyState, PageTitle, Panel, SectionHead, Segmented, Skeleton } from "@/kit/ui"

function Journal() {
  const { data } = useApi<JournalEntry[]>("/me/journal?limit=30")
  const units = useStore(selUnits)
  return (
    <Panel className="p-5">
      <SectionHead title="Travel journal" />
      {!data ? <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div> : data.length === 0 ? (
        <EmptyState icon={<ScrollText className="size-6" />} title="The journal is empty" body="Milestones and story moments will be written here as you walk." />
      ) : (
        <ol className="relative ml-4 border-l border-[var(--line)]">
          {data.map((j) => (
            <li key={j.id} className="relative pb-5 pl-6 last:pb-0">
              <span className="absolute -left-[17px] flex size-8 items-center justify-center rounded-full border border-[var(--line-hi)] bg-[var(--th-bg-2)] text-base"><EventGlyph kind={j.kind} className="size-4" /></span>
              <div className="font-display text-[15px] font-semibold">{j.title}</div>
              {j.body && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{j.body}</p>}
              <div className="tnum mt-1 text-[11px] text-muted-foreground/80">{fmtDist(j.at_m, units)} · {fmtAgo(j.created_utc)}</div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

export function MapView() {
  const journey = useStore((s) => s.journey)
  const me = useStore((s) => s.me)
  const subject = useStore((s) => s.snap?.subject)
  const units = useStore(selUnits)
  const { data: board } = useApi<Leaderboard>("/leaderboard?period=all")
  const [tab, setTab] = useState<"map" | "journal">("map")
  if (!journey || !subject || !me) return null
  const markers: MapMarker[] = [
    ...(board?.rows.filter((r) => !r.is_me).map((r) => ({ fraction: r.profile.fraction, avatar: r.profile.avatar, color: r.profile.color })) ?? []),
    { fraction: subject.fraction, avatar: me.avatar, color: me.color, label: me.display_name, me: true },
  ]
  return (
    <div>
      <PageTitle title="Map" sub={journey.subtitle} />
      <Segmented className="mb-4 lg:hidden" value={tab} onChange={setTab} options={[{ value: "map", label: "Map" }, { value: "journal", label: "Journal" }]} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <div className={tab === "journal" ? "hidden lg:block" : ""}>
          <Panel className="overflow-hidden p-2 lg:p-3">
            <QuestMap journey={journey} markers={markers} className="h-auto w-full rounded-2xl" />
            <div className="flex items-center justify-between px-3 py-3 text-xs text-muted-foreground">
              <span className="font-display">{journey.name}</span>
              <span className="tnum">{fmtDist(subject.progress_m, units, 1)} / {fmtDist(journey.total_m, units, 0)}</span>
            </div>
          </Panel>
          <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{journey.source_note}</p>
        </div>
        <div className={tab === "map" ? "hidden lg:block" : ""}><Journal /></div>
      </div>
    </div>
  )
}
