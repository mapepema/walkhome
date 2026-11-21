import { useState } from "react"
import { Gem } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { selUnits, useStore } from "@/lib/store"
import { fmtDist } from "@/lib/format"
import type { DailyRow, SessionRow, Streak } from "@/lib/types"
import { Avatar, Panel, SectionHead, Segmented, Skeleton } from "@/kit/ui"
import { Heatmap } from "./profile/Heatmap"
import { PaceLine, WeeklyBars } from "./profile/Charts"
import { Records } from "./profile/Records"
import { Sessions } from "./profile/Sessions"
import { Settings } from "./profile/Settings"

export function Profile() {
  const me = useStore((s) => s.me)
  const subject = useStore((s) => s.snap?.subject)
  const rank = useStore((s) => s.snap?.rank)
  const units = useStore(selUnits)
  const [tab, setTab] = useState<"activity" | "settings">("activity")
  const daily = useApi<DailyRow[]>("/me/daily?days=371")
  const sessions = useApi<SessionRow[]>("/me/sessions?limit=300")
  const streak = useApi<Streak>("/me/streak")
  if (!me) return null
  const goalM = me.daily_goal_m || 2000
  return (
    <div>
      <Panel hi className="relative mb-5 overflow-hidden p-5 lg:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full opacity-60 blur-3xl" style={{ background: "var(--th-glow)" }} />
        <div className="relative flex items-center gap-4 lg:gap-5">
          <Avatar emoji={me.avatar} color={me.color} size={76} ring />
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-2xl font-bold lg:text-3xl">{me.display_name}</h1>
            <div className="text-sm text-muted-foreground">@{me.username}{me.is_admin ? " · admin" : ""}</div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm lg:hidden">
              <span><b className="tnum">{fmtDist(subject?.progress_m, units, 0)}</b> <span className="text-muted-foreground">walked</span></span>
              {rank?.week && <span><b className="tnum">#{rank.week}</b> <span className="text-muted-foreground">this week</span></span>}
              <span className="flex items-center gap-1"><Gem className="size-3.5 text-gold" /><b className="tnum">{me.wallet.essence}</b> <span className="text-muted-foreground">essence</span></span>
            </div>
          </div>
          <div className="hidden gap-8 pr-4 lg:flex">
            {[
              { v: fmtDist(subject?.progress_m, units, 0), l: "walked" },
              { v: rank?.week ? `#${rank.week}` : "—", l: "this week" },
              { v: String(me.wallet.essence), l: "essence" },
            ].map((x) => (
              <div key={x.l} className="text-center"><div className="tnum font-display text-3xl font-bold">{x.v}</div><div className="eyebrow mt-1">{x.l}</div></div>
            ))}
          </div>
        </div>
      </Panel>
      <Segmented className="mb-5" value={tab} onChange={setTab} options={[{ value: "activity", label: "Activity" }, { value: "settings", label: "Settings" }]} />
      {tab === "settings" ? <Settings /> : (
        <div className="flex flex-col gap-4 lg:gap-5">
          <Panel className="p-5">
            <SectionHead title="Calendar" />
            {daily.data ? <Heatmap daily={daily.data} goalM={goalM} units={units} /> : <Skeleton className="h-28" />}
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
            <Panel className="p-5"><SectionHead title={`Distance per week (${units === "mi" ? "mi" : "km"})`} />{daily.data ? <WeeklyBars daily={daily.data} units={units} /> : <Skeleton className="h-40" />}</Panel>
            <Panel className="p-5"><SectionHead title="Average pace" />{sessions.data ? <PaceLine sessions={sessions.data} units={units} /> : <Skeleton className="h-40" />}</Panel>
          </div>
          <div>
            <SectionHead title="Records & streaks" />
            {sessions.data && daily.data ? <Records sessions={sessions.data} daily={daily.data} streak={streak.data} units={units} /> : <Skeleton className="h-40" />}
          </div>
          <div>
            <SectionHead title="My walks" />
            {sessions.data ? <Sessions sessions={sessions.data} units={units} onChanged={() => { sessions.reload(); daily.reload() }} /> : <Skeleton className="h-60" />}
          </div>
        </div>
      )}
    </div>
  )
}
