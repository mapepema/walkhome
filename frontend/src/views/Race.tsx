import { useState } from "react"
import { motion } from "framer-motion"
import { ArrowDown, ArrowUp, Minus, Target, Trophy } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { navigate, useRoute } from "@/lib/router"
import { fmtDist } from "@/lib/format"
import { selUnits, useStore } from "@/lib/store"
import type { Leaderboard, Period } from "@/lib/types"
import { Avatar, EmptyState, ErrorLine, PageTitle, Panel, Segmented, Skeleton } from "@/kit/ui"
import { cn } from "@/lib/utils"
import { Podium } from "./race/Podium"
import { LiveNow } from "./race/LiveNow"
import { ProfileDrawer } from "./race/ProfileDrawer"

const PERIODS: { value: Period; label: string }[] = [{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "all", label: "Total" }]

function Delta({ n }: { n: number }) {
  if (!n) return <Minus className="size-3.5 text-muted-foreground/50" aria-label="stable" />
  return n > 0
    ? <span className="flex items-center text-[11px] font-bold text-emerald-400" aria-label={`up ${n}`}><ArrowUp className="size-3.5" />{n}</span>
    : <span className="flex items-center text-[11px] font-bold text-red-400" aria-label={`down ${-n}`}><ArrowDown className="size-3.5" />{-n}</span>
}

export function Race() {
  const [period, setPeriod] = useState<Period>("week")
  const { data, error, reload } = useApi<Leaderboard>(`/leaderboard?period=${period}`)
  const units = useStore(selUnits)
  const journey = useStore((s) => s.journey)
  const route = useRoute()
  const profileId = route.rest[0] === "user" ? Number(route.rest[1]) || null : null
  const idx = data?.rows.findIndex((r) => r.is_me) ?? -1
  const me = idx >= 0 ? data!.rows[idx] : null
  const above = idx > 0 ? data!.rows[idx - 1] : null
  const below = data && idx >= 0 ? data.rows[idx + 1] : null

  return (
    <div>
      <PageTitle title="The race" sub={journey ? `On the road: ${journey.name}` : undefined} right={<Segmented value={period} onChange={setPeriod} options={PERIODS} className="hidden sm:inline-flex" />} />
      <Segmented value={period} onChange={setPeriod} options={PERIODS} className="mb-4 w-full sm:hidden [&>button]:flex-1" />
      {error && <ErrorLine message={error} retry={reload} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4">
          {!data ? <Skeleton className="h-60" /> : data.rows.length === 0 ? (
            <Panel><EmptyState icon={<Trophy className="size-6" />} title="The race has not started" body="Walk first to take the lead." /></Panel>
          ) : <Podium rows={data.rows.slice(0, 3)} units={units} />}

          {me && (above || below) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {above && <Panel hi className="flex items-center gap-3 p-4"><Target className="size-5 shrink-0 text-gold" /><p className="text-sm leading-snug">To overtake <b>{above.profile.display_name}</b>: <b className="tnum text-gold">{fmtDist(above.distance_m - me.distance_m, units, 2)}</b></p></Panel>}
              {below && <Panel className="flex items-center gap-3 p-4"><Avatar emoji={below.profile.avatar} color={below.profile.color} size={30} /><p className="text-sm leading-snug"><b>{below.profile.display_name}</b> is behind you by <b className="tnum">{fmtDist(me.distance_m - below.distance_m, units, 2)}</b></p></Panel>}
            </div>
          )}

          <Panel className="overflow-hidden p-2">
            {!data ? <div className="flex flex-col gap-2 p-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div> : (
              <ol>
                {data.rows.map((r, i) => (
                  <motion.li key={r.profile.id} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.025 }}>
                    <button onClick={() => navigate("race", "user", String(r.profile.id))} className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/6", r.is_me && "bg-[color-mix(in_oklab,var(--th-accent)_10%,transparent)] ring-1 ring-[var(--line-hi)]")}>
                      <span className={cn("tnum w-7 text-center text-base font-bold", r.rank <= 3 ? "text-gold" : "text-muted-foreground")}>{r.rank}</span>
                      <Avatar emoji={r.profile.avatar} color={r.profile.color} size={42} live={r.profile.walking_now} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.profile.display_name}{r.is_me && <span className="font-normal text-muted-foreground"> · you</span>}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{r.profile.biome_name ?? "—"}{r.profile.streak_days > 2 ? ` · ${r.profile.streak_days}-day streak` : ""}</span>
                      </span>
                      <span className="text-right">
                        <span className="tnum block text-sm font-bold">{fmtDist(r.distance_m, units)}</span>
                        <span className="tnum block text-[11px] text-muted-foreground">{r.gap_to_next_m != null ? `−${fmtDist(r.gap_to_next_m, units, 2)}` : "leading"}</span>
                      </span>
                      <span className="w-8 shrink-0 text-right"><Delta n={r.delta_rank} /></span>
                    </button>
                  </motion.li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-4"><LiveNow /></div>
      </div>
      <ProfileDrawer id={profileId} />
    </div>
  )
}
