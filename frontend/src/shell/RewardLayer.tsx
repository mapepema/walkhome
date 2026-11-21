import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Gift } from "lucide-react"
import { selSession, useStore } from "@/lib/store"
import { useRoute } from "@/lib/router"
import { useUi } from "@/lib/ui"
import { confettiBurst } from "@/lib/fx"
import { PackArt } from "@/kit/PackArt"
import type { RewardEvent } from "@/lib/types"

const COLORS = ["#ffffff", "#e5e5ea", "#e3b45c"]

/** "Pack earned" — a full celebration outside a walk, a compact banner during one. */
export function RewardLayer() {
  const ev = useStore((s) => s.rewards[0])
  const shift = useStore((s) => s.shiftReward)
  const walking = useStore((s) => !!selSession(s))
  const tab = useRoute().tab
  const inWalk = walking && tab === "walk"
  const openPack = useUi((s) => s.openPack)

  useEffect(() => {
    if (!ev) return
    confettiBurst(COLORS, { big: !inWalk })
    if (inWalk) {
      const t = setTimeout(shift, 9000)
      return () => clearTimeout(t)
    }
  }, [ev, inWalk, shift])

  const open = (e: RewardEvent) => {
    shift()
    openPack(e.grants[0])
  }

  return (
    <AnimatePresence mode="wait">
      {ev && inWalk && (
        <motion.div
          key={"c" + ev.grants[0]?.id}
          initial={{ y: -90, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ type: "spring", damping: 18, stiffness: 260 }}
          className="glass-dark glass-hi fixed inset-x-3 top-[max(0.75rem,var(--safe-top))] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3 pr-3.5"
          role="status"
        >
          <PackArt size={42} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Pack earned</div>
            <div className="truncate text-xs text-muted-foreground">{ev.title}</div>
          </div>
          <button onClick={() => open(ev)} className="btn-gold rounded-full px-4 py-2 text-xs">Open</button>
          <button onClick={shift} className="px-1 text-xs text-muted-foreground">Later</button>
        </motion.div>
      )}
      {ev && !inWalk && (
        <motion.div
          key={"f" + ev.grants[0]?.id}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-black/75 px-6 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Pack earned"
        >
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: "easeOut" }}>
            <PackArt size={150} label={ev.grants.length > 1 ? `×${ev.grants.length}` : undefined} />
          </motion.div>
          <motion.div className="relative mt-8 text-center" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <div className="eyebrow">Reward</div>
            <h2 className="font-display mt-1.5 text-[32px] leading-tight">{ev.grants.length > 1 ? `${ev.grants.length} packs earned!` : "Pack earned!"}</h2>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">{ev.title}</p>
          </motion.div>
          <motion.div className="relative mt-8 flex w-full max-w-xs flex-col gap-2.5" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
            <button onClick={() => open(ev)} className="btn-gold flex h-14 items-center justify-center gap-2 rounded-full text-base"><Gift className="size-5" /> Open now</button>
            <button onClick={shift} className="h-11 rounded-full text-sm font-semibold text-muted-foreground hover:text-foreground">Later</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
