import { useState } from "react"
import { Footprints, Keyboard, Pencil, Trash2 } from "lucide-react"
import { del, errMsg, patch } from "@/lib/api"
import { fmtDist, fmtDur, fmtPace } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import { useStore } from "@/lib/store"
import type { SessionRow, Units } from "@/lib/types"
import { Sheet } from "@/kit/Sheet"
import { EmptyState, Panel } from "@/kit/ui"
import { toast } from "sonner"

/** My sessions only: edit the note, or delete the walk (progress recalculates). */
export function Sessions({ sessions, units, onChanged }: { sessions: SessionRow[]; units: Units; onChanged: () => void }) {
  const [edit, setEdit] = useState<SessionRow | null>(null)
  const [note, setNote] = useState("")
  const [confirm, setConfirm] = useState(false)
  const [shown, setShown] = useState(12)
  const refresh = useStore((s) => s.refresh)
  const bump = useStore((s) => s.bump)

  const open = (s: SessionRow) => { setEdit(s); setNote(s.note ?? ""); setConfirm(false) }
  const save = async () => {
    if (!edit) return
    try { await patch(`/me/sessions/${edit.id}`, { note }); toast.success("Note saved"); setEdit(null); onChanged() } catch (e) { toast.error(errMsg(e)) }
  }
  const remove = async () => {
    if (!edit) return
    try { await del(`/me/sessions/${edit.id}`); haptic.success(); toast.success("Walk deleted"); setEdit(null); onChanged(); await refresh(); bump() } catch (e) { toast.error(errMsg(e)) }
  }

  if (!sessions.length) return <Panel><EmptyState icon={<Footprints className="size-6" />} title="No walks yet" body="Your first walk will show up here with its stats." /></Panel>
  return (
    <>
      <Panel className="divide-y divide-[var(--line)] p-1.5">
        {sessions.slice(0, shown).map((s) => {
          const d = new Date(s.start_utc)
          const kmh = s.moving_s > 0 ? s.distance_m / 1000 / (s.moving_s / 3600) : 0
          return (
            <button key={s.id} onClick={() => open(s)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-white/6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/6">{s.source === "manual" ? <Keyboard className="size-[18px] text-muted-foreground" /> : <Footprints className="size-[18px] text-gold" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} <span className="font-normal text-muted-foreground">· {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span></span>
                <span className="block truncate text-xs text-muted-foreground">{s.note ?? (s.source === "manual" ? "Manual entry" : "Treadmill")}</span>
              </span>
              <span className="tnum text-right"><span className="block text-sm font-bold">{fmtDist(s.distance_m, units, 2)}</span><span className="block text-[11px] text-muted-foreground">{fmtDur(s.elapsed_s)} · {fmtPace(kmh, units)}</span></span>
              <Pencil className="size-3.5 shrink-0 text-muted-foreground/60" />
            </button>
          )
        })}
      </Panel>
      {shown < sessions.length && <button onClick={() => setShown((n) => n + 12)} className="btn-ghost-gold mx-auto mt-3 block rounded-full px-5 py-2 text-sm font-semibold">Show more</button>}
      <Sheet open={!!edit} onClose={() => setEdit(null)} title="Edit walk" description={edit ? `${fmtDist(edit.distance_m, units, 2)} · ${new Date(edit.start_utc).toLocaleDateString("en-GB")}` : undefined} variant="modal">
        {edit && (
          <div className="flex flex-col gap-3 pb-3">
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="sess-note">Note</label>
            <input id="sess-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="around the lake" className="h-12 rounded-xl border border-[var(--line)] bg-black/25 px-3.5 text-[15px] outline-none focus:border-[var(--th-accent)]" />
            <button onClick={save} className="btn-gold h-12 rounded-full">Save</button>
            {!confirm ? (
              <button onClick={() => setConfirm(true)} className="flex h-11 items-center justify-center gap-2 text-sm font-semibold text-red-300"><Trash2 className="size-4" /> Delete this walk</button>
            ) : (
              <div className="rounded-xl border border-red-400/30 bg-red-400/10 p-3.5 text-sm">
                <p className="text-red-100">Its distance will be removed from your progress. This cannot be undone.</p>
                <div className="mt-3 flex gap-2"><button onClick={remove} className="h-10 flex-1 rounded-xl bg-red-500/80 font-semibold text-white">Delete</button><button onClick={() => setConfirm(false)} className="h-10 flex-1 rounded-xl bg-white/10 font-semibold">Cancel</button></div>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </>
  )
}
