import { useState } from "react"
import { ArrowLeft, Pause, Play, Square } from "lucide-react"
import { post, errMsg } from "@/lib/api"
import { navigate } from "@/lib/router"
import { haptic } from "@/lib/haptics"
import { Sheet } from "@/kit/Sheet"
import { toast } from "sonner"
import type { SessionSnap } from "@/lib/types"

export function Controls({ session, onStopped }: { session: SessionSnap; onStopped: (note: string) => void }) {
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    haptic.tap()
    try { await post(session.manual_pause ? "/me/walk/resume" : "/me/walk/pause") } catch (e) { toast.error(errMsg(e)) }
  }
  const stop = async () => {
    setBusy(true)
    try {
      await post("/me/walk/stop", note ? { note } : {})
      haptic.success()
      setConfirm(false)
      onStopped(note)
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <div className="flex gap-2.5 lg:mt-1">
        <button onClick={() => navigate("camp")} aria-label="Back to camp" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-white"><ArrowLeft className="size-5" /></button>
        <button onClick={toggle} className="flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-white/10 text-[15px] font-semibold text-white">
          {session.manual_pause ? <><Play className="size-5" fill="currentColor" /> Resume</> : <><Pause className="size-5" fill="currentColor" /> Pause</>}
        </button>
        <button onClick={() => setConfirm(true)} className="flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-red-500/90 text-[15px] font-semibold text-white">
          <Square className="size-4" fill="currentColor" /> End
        </button>
      </div>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title="End the walk?" description="Your distance is already saved as you go." variant="modal">
        <div className="flex flex-col gap-3 pb-3">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="A note? (optional)" aria-label="Note" className="h-12 rounded-xl border border-[var(--line)] bg-black/25 px-3.5 text-[15px] outline-none focus:border-[var(--th-accent)]" />
          <button onClick={stop} disabled={busy} className="btn-gold h-13 rounded-full py-3.5 text-base">End and see the summary</button>
          <button onClick={() => setConfirm(false)} className="h-11 text-sm font-semibold text-muted-foreground">Keep walking</button>
        </div>
      </Sheet>
    </>
  )
}
