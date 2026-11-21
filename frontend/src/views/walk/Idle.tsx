import { useEffect } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Check, Footprints, Keyboard, Play, Trophy } from "lucide-react"
import { selUnits, useStore } from "@/lib/store"
import { navigate } from "@/lib/router"
import { useUi } from "@/lib/ui"
import { useStartWalk } from "@/lib/walk"
import { fmtDist, fmtDur, fmtPace } from "@/lib/format"
import { confettiBurst } from "@/lib/fx"
import { Avatar, Panel } from "@/kit/ui"

export interface Summary { distance_m: number; moving_s: number; elapsed_s: number; maxKmh: number; packsGained: number }

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="glass rounded-2xl p-3.5 text-center"><div className="tnum text-xl font-bold">{value}</div><div className="eyebrow mt-1">{label}</div></div>
}

export function Idle({ summary, onClear }: { summary: Summary | null; onClear: () => void }) {
  const treadmill = useStore((s) => s.snap?.treadmill)
  const link = useStore((s) => s.snap?.link)
  const live = useStore((s) => s.live)
  const units = useStore(selUnits)
  const me = useStore((s) => s.me)
  const setManual = useUi((s) => s.setManual)
  const { start, busy } = useStartWalk()
  const other = treadmill?.busy ? treadmill.walker : null
  const liveSpeed = other ? live.find((w) => w.user_id === other.id)?.speed_kmh : undefined

  useEffect(() => {
    if (summary) confettiBurst(["#fff3c4", "#e3b45c", "#34d399"], { big: summary.distance_m > 1000 })
  }, [summary])

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-xl flex-col items-center justify-center gap-6 py-6 text-center lg:min-h-[70dvh]">
      {summary ? (
        <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} className="w-full">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[var(--th-accent)] text-[var(--th-accent-fg)]"><Check className="size-8" strokeWidth={2.5} /></div>
          <h1 className="font-display mt-4 text-[34px]">Walk complete</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every step brings the quest closer to its end.</p>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <Stat label="Distance" value={fmtDist(summary.distance_m, units, 2)} />
            <Stat label="Temps" value={fmtDur(summary.elapsed_s)} />
            <Stat label="Pace" value={fmtPace(summary.distance_m / 1000 / Math.max(1, summary.moving_s / 3600), units)} />
          </div>
          {summary.packsGained > 0 && <Panel hi className="mt-3 p-3.5 text-sm font-semibold">{summary.packsGained} pack{summary.packsGained > 1 ? "s" : ""} earned during this walk!</Panel>}
          <div className="mt-6 flex flex-col gap-2.5">
            <button onClick={() => { onClear(); navigate("camp") }} className="btn-gold h-14 rounded-full text-base">Back to camp</button>
            <button onClick={() => { onClear(); navigate("race") }} className="btn-ghost-gold flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold"><Trophy className="size-4" /> See the race</button>
          </div>
        </motion.div>
      ) : other ? (
        <div className="w-full">
          <div className="relative mx-auto w-fit"><Avatar emoji={other.avatar} color={other.color} size={96} live ring /></div>
          <div className="eyebrow mt-5">Treadmill busy</div>
          <h1 className="font-display mt-1 text-[30px]">{other.display_name} is walking right now</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            The treadmill takes one person at a time{liveSpeed ? <> — {other.display_name} is going <b className="tnum text-foreground">{liveSpeed.toFixed(1)} km/h</b></> : null}. You will be up as soon as they finish.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button disabled className="btn-gold flex h-14 items-center justify-center gap-2 rounded-full text-base"><Play className="size-5" /> Walk (treadmill busy)</button>
            <button onClick={() => setManual(true)} className="btn-ghost-gold flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold"><Keyboard className="size-4" /> Log a walk manually</button>
            <button onClick={() => navigate("race")} className="h-11 text-sm font-semibold text-muted-foreground">Follow the race</button>
          </div>
        </div>
      ) : (
        <div className="w-full">
          <div className="mx-auto mb-5 flex size-20 items-center justify-center rounded-full bg-white/8"><Footprints className="size-9 text-gold" strokeWidth={1.6} /></div>
          <h1 className="font-display text-[32px]">Ready, {me?.display_name}?</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{link?.state === "live" ? "The treadmill is ready for you." : link?.detail || "Treadmill not detected: check that it is switched on."}</p>
          <div className="mt-6 flex flex-col gap-2.5">
            <button onClick={start} disabled={busy} className="btn-gold flex h-16 items-center justify-center gap-3 rounded-full text-lg"><Footprints className="size-6" /> Start walking</button>
            <button onClick={() => setManual(true)} className="btn-ghost-gold flex h-12 items-center justify-center gap-2 rounded-full text-sm font-semibold"><Keyboard className="size-4" /> Log a walk manually</button>
            <button onClick={() => navigate("camp")} className="flex h-11 items-center justify-center gap-1.5 text-sm font-semibold text-muted-foreground"><ArrowLeft className="size-4" /> Back to camp</button>
          </div>
        </div>
      )}
    </div>
  )
}
