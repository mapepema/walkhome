import { useMemo, useState } from "react"
import { Info, Loader2 } from "lucide-react"
import { errMsg, post } from "@/lib/api"
import { selUnits, useStore } from "@/lib/store"
import { useUi } from "@/lib/ui"
import { fromUnit, unitLabel } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { Sheet } from "@/kit/Sheet"
import { Field } from "@/kit/Field"
import { toast } from "sonner"

const localNow = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

/** Manual distance entry with the anti-cheat caps spelled out. */
export function ManualSheet() {
  const { manualOpen, setManual } = useUi()
  const units = useStore(selUnits)
  const refresh = useStore((s) => s.refresh)
  const bump = useStore((s) => s.bump)
  const [dist, setDist] = useState("")
  const [min, setMin] = useState("")
  const [when, setWhen] = useState(localNow)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const d = parseFloat(dist.replace(",", "."))
  const m = parseFloat(min)
  const speed = useMemo(() => (d > 0 && m > 0 ? (fromUnit(d, units) / 1000) / (m / 60) : null), [d, m, units])
  const invalid = speed != null && speed > 400
  const noReward = speed != null && speed > 12

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await post("/me/sessions/manual", { distance_m: Math.round(fromUnit(d, units)), minutes: m, note: note || undefined, when_utc: new Date(when).toISOString() })
      haptic.success()
      toast.success("Walk added", { description: "It counts toward your progress and the leaderboard." })
      setManual(false)
      setDist(""); setMin(""); setNote("")
      await refresh(); bump()
    } catch (err) { haptic.warn(); toast.error(errMsg(err)) } finally { setBusy(false) }
  }

  return (
    <Sheet open={manualOpen} onClose={() => setManual(false)} title="Log a walk" description="A walk outdoors, or a session done without the app." variant="modal">
      <form onSubmit={submit} className="flex flex-col gap-4 pb-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Distance (${unitLabel(units)})`} inputMode="decimal" value={dist} onChange={(e) => setDist(e.target.value)} placeholder="2,5" required />
          <Field label="Duration (min)" inputMode="numeric" type="number" min={1} value={min} onChange={(e) => setMin(e.target.value)} placeholder="35" required />
        </div>
        <Field label="When?" type="datetime-local" max={localNow()} value={when} onChange={(e) => setWhen(e.target.value)} />
        <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="around the lake" />
        {speed != null && (
          <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${invalid ? "border-red-400/40 bg-red-400/10 text-red-200" : noReward ? "border-amber-400/40 bg-amber-400/10 text-amber-100" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"}`}>
            Implied speed: <b className="tnum">{speed.toFixed(1)} km/h</b> — {invalid ? "rejected (implausible)." : noReward ? "above 12 km/h, no reward will be given." : "eligible for rewards."}
          </div>
        )}
        <div className="flex gap-2.5 rounded-xl bg-white/5 p-3.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-gold" />
          <ul className="list-disc space-y-1 pl-3.5">
            <li>The distance counts in full toward your <b className="text-foreground">progress</b> and the <b className="text-foreground">leaderboard</b>.</li>
            <li><b className="text-foreground">Rewards</b> (packs, quests) are capped at <b className="text-foreground">5 km of manual entries per day</b>.</li>
            <li>Above an implied speed of 12 km/h the walk earns no reward; above 400 km/h it is rejected.</li>
          </ul>
        </div>
        <button type="submit" disabled={busy || invalid || !(d > 0) || !(m > 0)} className="btn-gold flex h-13 items-center justify-center gap-2 rounded-full py-3.5 text-base">
          {busy ? <Loader2 className="size-5 animate-spin" /> : "Add walk"}
        </button>
      </form>
    </Sheet>
  )
}
