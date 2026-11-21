import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowDown, ArrowUp } from "lucide-react"
import { useStore } from "@/lib/store"
import { navigate } from "@/lib/router"
import { confettiBurst } from "@/lib/fx"
import { Avatar } from "@/kit/ui"

/** Overtake alerts: a celebration when we pass someone, an alert when we're passed. */
export function RankLayer() {
  const ev = useStore((s) => s.rankEvents[0])
  const shift = useStore((s) => s.shiftRank)
  const up = !!ev?.overtook
  useEffect(() => {
    if (!ev) return
    if (up) confettiBurst(["#34d399", "#e3b45c", "#ffffff"], { big: false })
    const t = setTimeout(shift, 7500)
    return () => clearTimeout(t)
  }, [ev, up, shift])
  const other = ev?.overtook ?? ev?.overtaken_by
  return (
    <AnimatePresence>
      {ev && other && (
        <motion.div
          key={ev.rank + "-" + ev.previous_rank + other.id}
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", damping: 18, stiffness: 240 }}
          className="glass-dark fixed inset-x-3 top-[max(0.75rem,var(--safe-top))] z-[85] mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3"
          
          role="alert"
        >
          <Avatar emoji={other.avatar} color={other.color} size={44} />
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-1.5 text-[15px] font-semibold ${up ? "text-emerald-300" : "text-red-300"}`}>
              {up ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
              {up ? `You overtake ${other.display_name}!` : `${other.display_name} overtakes you`}
            </div>
            <div className="text-xs text-muted-foreground">
              {up ? "New rank" : "You drop to rank"} <b className="text-foreground">#{ev.rank}</b> <span className="opacity-60">(was #{ev.previous_rank})</span>
            </div>
          </div>
          <button onClick={() => { shift(); navigate("race") }} className="btn-ghost-gold rounded-full px-3.5 py-2 text-xs font-semibold">{up ? "View" : "Fight back"}</button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
