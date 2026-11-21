import { selUnits, useStore } from "@/lib/store"
import { fmtDur, fmtNum, fmtPace, unitLabel, fmtDist } from "@/lib/format"
import { Ring } from "@/kit/ui"
import type { SessionSnap } from "@/lib/types"

/** The big dial: speed in the centre, progress to the next pack around it. */
export function SpeedDial({ session }: { session: SessionSnap }) {
  const units = useStore(selUnits)
  const packs = useStore((s) => s.snap?.packs)
  const speed = units === "mi" ? session.telemetry.speed_kmh / 1.609344 : session.telemetry.speed_kmh
  const frac = packs ? 1 - packs.next_pack_in_m / packs.pack_every_m : 0
  return (
    <div className="flex flex-col items-center">
      <Ring value={frac} size={288} stroke={10} className="max-w-full">
        <div className="tnum text-[84px] font-semibold leading-none tracking-tight text-white">{speed.toFixed(1)}</div>
        <div className="mt-1 text-base font-medium text-white/55">{units === "mi" ? "mph" : "km/h"}</div>
      </Ring>
      {packs && <div className="mt-4 text-[15px] text-white/65">Next pack in <b className="tnum font-semibold text-white">{fmtDist(packs.next_pack_in_m, units, 2)}</b></div>}
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-2xl bg-white/6 px-4 py-3.5">
      <div className="text-xs font-medium text-white/55">{label}</div>
      <div className="tnum mt-1 text-[26px] font-semibold leading-none tracking-tight text-white">{value}{unit && <span className="ml-1 text-sm font-medium text-white/50">{unit}</span>}</div>
    </div>
  )
}

export function StatGrid({ session }: { session: SessionSnap }) {
  const units = useStore(selUnits)
  const t = session.telemetry
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
      <Stat label="Distance" value={fmtNum(t.distance_m, units, 2)} unit={unitLabel(units)} />
      <Stat label="Time" value={fmtDur(t.elapsed_s)} />
      <Stat label={`Pace /${unitLabel(units)}`} value={fmtPace(t.speed_kmh, units)} />
      <Stat label="Heart rate" value={session.heart_rate_bpm ? String(session.heart_rate_bpm) : "—"} unit={session.heart_rate_bpm ? "bpm" : undefined} />
    </div>
  )
}
