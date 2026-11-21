import { motion } from "framer-motion"
import { Footprints, Play, Users } from "lucide-react"
import { selSession, useStore } from "@/lib/store"
import { navigate } from "@/lib/router"
import { useStartWalk } from "@/lib/walk"
import { Avatar } from "@/kit/ui"
import { fmtSpeed } from "@/lib/format"

/** The giant button. */
export function WalkCta() {
  const session = useStore(selSession)
  const treadmill = useStore((s) => s.snap?.treadmill)
  const units = useStore((s) => s.snap?.units ?? "km")
  const { start, busy } = useStartWalk()
  const mine = !!session
  const other = treadmill?.busy && !mine ? treadmill.walker : null

  if (other)
    return (
      <button onClick={() => navigate("walk")} className="glass flex w-full items-center gap-3 p-4 text-left">
        <Avatar emoji={other.avatar} color={other.color} size={48} live />
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Treadmill busy</div>
          <div className="truncate text-[15px] font-semibold">{other.display_name} is walking right now</div>
          <div className="text-xs text-muted-foreground">Log a walk manually or wait for your turn.</div>
        </div>
        <Users className="size-5 text-muted-foreground" />
      </button>
    )

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={mine ? () => navigate("walk") : start}
      disabled={busy}
      className="btn-gold group relative flex h-16 w-full items-center justify-center gap-3 overflow-hidden rounded-full text-[17px] lg:h-[68px]"
    >
            {mine ? (
        <>
          <span className="size-2.5 rounded-full bg-emerald-700" />
          Resume walk
          <span className="tnum text-base font-semibold opacity-75">{fmtSpeed(session.telemetry.speed_kmh, units)}</span>
        </>
      ) : (
        <>
          {busy ? <Footprints className="size-5" /> : <Play className="size-5" fill="currentColor" />}
          Walk
        </>
      )}
    </motion.button>
  )
}
