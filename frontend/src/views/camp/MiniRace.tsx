import { ArrowUp, ChevronRight } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { href } from "@/lib/router"
import { selUnits, useStore } from "@/lib/store"
import { fmtDist } from "@/lib/format"
import type { Leaderboard } from "@/lib/types"
import { Avatar, Panel, SectionHead, Skeleton } from "@/kit/ui"
import { cn } from "@/lib/utils"

/** Where I stand, who I'm chasing, and who is chasing me. */
export function MiniRace() {
  const { data } = useApi<Leaderboard>("/leaderboard?period=week")
  const units = useStore(selUnits)
  const idx = data?.rows.findIndex((r) => r.is_me) ?? -1
  const rows = data && idx >= 0 ? data.rows.slice(Math.max(0, idx - 1), idx + 2) : data?.rows.slice(0, 3) ?? []
  const above = idx > 0 ? data!.rows[idx - 1] : null
  return (
    <Panel className="p-5">
      <SectionHead title="This week's race" action={<a href={href("race")} className="flex items-center text-xs font-semibold text-gold">Leaderboard <ChevronRight className="size-3.5" /></a>} />
      {!data ? (
        <div className="flex flex-col gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {rows.map((r) => (
              <li key={r.profile.id} className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2", r.is_me && "border border-[var(--line-hi)] bg-[color-mix(in_oklab,var(--th-accent)_9%,transparent)]")}>
                <span className={cn("tnum w-6 text-center text-sm font-bold", r.rank <= 3 ? "text-gold" : "text-muted-foreground")}>{r.rank}</span>
                <Avatar emoji={r.profile.avatar} color={r.profile.color} size={34} live={r.profile.walking_now} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.profile.display_name}{r.is_me && <span className="font-normal text-muted-foreground"> · you</span>}</span>
                <span className="tnum text-sm font-semibold">{fmtDist(r.distance_m, units)}</span>
              </li>
            ))}
          </ul>
          {above && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-xs text-foreground/85">
              <ArrowUp className="size-3.5 shrink-0 text-gold" />
              <span><b className="tnum text-gold">{fmtDist(above.distance_m - data!.rows[idx].distance_m, units, 2)}</b> more to overtake <b>{above.profile.display_name}</b></span>
            </p>
          )}
          {idx === 0 && <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs text-foreground/85">You are leading the race. Keep the pace.</p>}
        </>
      )}
    </Panel>
  )
}
