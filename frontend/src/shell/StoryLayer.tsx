import { AnimatePresence, motion } from "framer-motion"
import { Check, Compass, X } from "lucide-react"
import { EventGlyph } from "@/kit/icons"
import { useStore, selPending } from "@/lib/store"
import { post, errMsg } from "@/lib/api"
import { haptic } from "@/lib/haptics"
import { Sheet } from "@/kit/Sheet"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

/** Story cards (milestones / beats), route choices, and challenge results. */
export function StoryLayer() {
  const card = useStore((s) => s.cards[0])
  const shiftCard = useStore((s) => s.shiftCard)
  const pushCard = useStore((s) => s.pushCard)
  const choice = useStore(selPending)
  const result = useStore((s) => s.challengeResult)
  const dismiss = useStore((s) => s.dismissChallengeResult)

  const pick = async (optionId: string) => {
    if (!choice) return
    haptic.select()
    try {
      const r = await post<{ option: { label: string; outcome?: string } }>("/me/walk/choice", { event_id: choice.event_id, option_id: optionId })
      if (r.option.outcome) pushCard({ key: `choice:${choice.event_id}:${optionId}`, icon: "compass", title: r.option.label, body: r.option.outcome })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <>
      <Sheet open={!!choice} onClose={() => {}} locked title={choice?.title ?? ""} variant="modal" description="Your choice changes the road.">
        {choice && (
          <div className="pb-3">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/8"><Compass className="size-5 text-gold" /></span>
              <p className="text-[15px] leading-relaxed text-foreground/90">{choice.body}</p>
            </div>
            <div className="flex flex-col gap-2.5">
              {choice.options.map((o) => (
                <button key={o.id} onClick={() => pick(o.id)} className="glass hover:glass-hi flex flex-col items-start gap-0.5 p-4 text-left transition-transform active:scale-[0.99]">
                  <span className="text-[15px] font-semibold">{o.label}</span>
                  {o.detail && <span className="text-xs text-muted-foreground">{o.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Sheet>
      <AnimatePresence>
        {card && !choice && (
          <motion.div key={card.key} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm lg:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={shiftCard}>
            <motion.div
              initial={{ y: 60, scale: 0.94, opacity: 0 }} animate={{ y: 0, scale: 1, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 20, stiffness: 260 }}
              className="glass glass-hi w-full max-w-sm p-6 pb-5 text-center !bg-[var(--th-bg-2)]"
              onClick={(e) => e.stopPropagation()}
              role="dialog" aria-modal="true" aria-label={card.title}
            >
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-white/8"><EventGlyph kind={card.meta === "Milestone reached" ? "milestone" : "beat"} className="size-7 text-gold" /></div>
              {card.meta && <div className="eyebrow mt-3 text-gold">{card.meta}</div>}
              <h3 className="font-display mt-1.5 text-[26px] leading-tight">{card.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-foreground/85">{card.body}</p>
              <button onClick={shiftCard} className="btn-gold mt-6 h-12 w-full rounded-full">Continue</button>
            </motion.div>
          </motion.div>
        )}
        {result && !card && !choice && (
          <motion.div key="cr" initial={{ y: -80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -60, opacity: 0 }} transition={{ type: "spring", damping: 18, stiffness: 240 }}
            className={cn("glass-dark fixed inset-x-3 top-[max(0.75rem,var(--safe-top))] z-[75] mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3.5")}
            style={{ borderColor: result.succeeded ? "rgb(52 211 153 / .5)" : "var(--line)" }}
            onAnimationComplete={() => setTimeout(dismiss, 6000)} role="status">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", result.succeeded ? "bg-emerald-400/15 text-emerald-300" : "bg-white/8 text-muted-foreground")}>{result.succeeded ? <Check className="size-5" strokeWidth={2.4} /> : <X className="size-5" />}</span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[15px] font-semibold", result.succeeded ? "text-emerald-300" : "text-foreground")}>{result.succeeded ? "Challenge complete!" : "Challenge missed"}</div>
              <div className="truncate text-xs text-muted-foreground">{result.title}{result.succeeded && result.held_s ? ` · held ${Math.round(result.held_s)} s` : ""}</div>
            </div>
            <button onClick={dismiss} className="text-xs font-semibold text-muted-foreground">OK</button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
