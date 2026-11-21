import { useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import { fmtDist } from "@/lib/format"
import { selUnits, useStore } from "@/lib/store"
import type { LiveWalker } from "@/lib/types"
import { Avatar, Panel, SectionHead } from "@/kit/ui"

export function LiveNow() {
  const { data } = useApi<LiveWalker[]>("/live", { refreshMs: 10000 })
  const presence = useStore((s) => s.live)
  const units = useStore(selUnits)
  const rows = data ?? []
  return (
    <Panel className="p-5" aria-live="polite">
      <SectionHead title={<span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-400" /> Walking now</span>} />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{presence.length ? `${presence.length} player(s) walking.` : "Nobody is walking right now. Your turn to start the race!"}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((w) => {
            const live = presence.find((p) => p.user_id === w.profile.id)
            return (
              <li key={w.profile.id}>
                <button onClick={() => navigate("race", "user", String(w.profile.id))} className="flex w-full items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5 text-left hover:bg-white/10">
                  <Avatar emoji={w.profile.avatar} color={w.profile.color} size={38} live />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{w.profile.display_name}</span><span className="tnum text-xs text-muted-foreground">{fmtDist(w.session_distance_m, units, 2)} this walk</span></span>
                  <span className="tnum text-sm font-bold text-emerald-300">{(live?.speed_kmh ?? w.speed_kmh).toFixed(1)} <span className="text-[10px] font-medium text-muted-foreground">km/h</span></span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
