import { motion } from "framer-motion"
import { Crown } from "lucide-react"
import { fmtDist } from "@/lib/format"
import { navigate } from "@/lib/router"
import type { LeaderRow, Units } from "@/lib/types"
import { Avatar } from "@/kit/ui"
import { cn } from "@/lib/utils"

const H: Record<number, number> = { 1: 132, 2: 100, 3: 80 }
const MEDAL: Record<number, string> = { 1: "bg-amber-300", 2: "bg-slate-300", 3: "bg-orange-400" }

export function Podium({ rows, units }: { rows: LeaderRow[]; units: Units }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean)
  if (!rows.length) return null
  return (
    <div className="glass relative overflow-hidden px-3 pb-0 pt-7" role="list" aria-label="Podium">
      
      <div className="relative mx-auto flex max-w-md items-end justify-center gap-2.5">
        {order.map((r, i) => (
          <button key={r.profile.id} role="listitem" onClick={() => navigate("race", "user", String(r.profile.id))} className="flex min-w-0 flex-1 flex-col items-center">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 + i * 0.12, type: "spring", damping: 14 }} className="relative flex flex-col items-center">
              {r.rank === 1 && <Crown className="mb-1 size-6 text-amber-300 " fill="currentColor" />}
              <Avatar emoji={r.profile.avatar} color={r.profile.color} size={r.rank === 1 ? 72 : 58} ring live={r.profile.walking_now} />
              <div className={cn("mt-2 max-w-full truncate text-sm font-bold", r.is_me && "text-gold")}>{r.profile.display_name}</div>
              <div className="tnum text-xs font-semibold text-muted-foreground">{fmtDist(r.distance_m, units)}</div>
            </motion.div>
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: H[r.rank] }}
              transition={{ delay: 0.1 + i * 0.1, type: "spring", damping: 18, stiffness: 120 }}
              className={cn("mt-3 flex w-full items-start justify-center rounded-t-2xl border-x border-t border-white/15 bg-gradient-to-b pt-3 shadow-inner", r.rank === 1 ? "from-[color-mix(in_oklab,var(--th-accent)_35%,transparent)] to-transparent" : "from-white/12 to-transparent")}
            >
              <span className={cn("flex size-9 items-center justify-center rounded-full text-base font-semibold text-black/80", MEDAL[r.rank])}>{r.rank}</span>
            </motion.div>
          </button>
        ))}
      </div>
    </div>
  )
}
