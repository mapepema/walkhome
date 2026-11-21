import { Gift } from "lucide-react"
import { useStore, selUnits } from "@/lib/store"
import { useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import { useUi } from "@/lib/ui"
import { fmtDist } from "@/lib/format"
import type { PacksInfo } from "@/lib/types"
import { PackArt } from "@/kit/PackArt"
import { Panel, Ring } from "@/kit/ui"

/** "Next pack in X km" gauge + ready packs with a straight line to the opening. */
export function PackCard() {
  const packs = useStore((s) => s.snap?.packs)
  const units = useStore(selUnits)
  const openPack = useUi((s) => s.openPack)
  const { data } = useApi<PacksInfo>(packs?.unopened ? "/me/packs" : null)
  if (!packs) return null
  const frac = 1 - packs.next_pack_in_m / packs.pack_every_m
  const ready = packs.unopened
  return (
    <Panel hi={ready > 0} className="p-5">
      <div className="flex items-center gap-4">
        <Ring value={frac} size={92} stroke={8}>
          <div className="tnum text-[17px] font-bold leading-none">{fmtDist(packs.next_pack_in_m, units, 1).replace(" ", " ")}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">left</div>
        </Ring>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Next pack</div>
          <p className="mt-1 text-sm leading-snug text-foreground/90">
            Walk <b className="text-foreground">{fmtDist(packs.next_pack_in_m, units, 1)}</b> more to earn a card pack.
          </p>
          <div className="mt-1 text-[11px] text-muted-foreground">1 pack every {fmtDist(packs.pack_every_m, units, 0)}</div>
        </div>
      </div>
      {ready > 0 && (
        <div className="mt-4 flex items-center gap-4 border-t border-[var(--line)] pt-4">
          <div className="relative h-16 w-20 shrink-0">
            {Array.from({ length: Math.min(ready, 3) }).map((_, i) => (
              <div key={i} className="absolute top-0" style={{ left: i * 14, transform: `rotate(${(i - 1) * 7}deg)`, zIndex: i }}>
                <PackArt size={44} />
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">{ready} pack{ready > 1 ? "s" : ""} ready</div>
            <div className="text-xs text-muted-foreground">Discover your new cards.</div>
          </div>
          <button onClick={() => (data?.unopened[0] ? openPack(data.unopened[0]) : navigate("packs"))} className="btn-gold flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs">
            <Gift className="size-4" /> Open
          </button>
        </div>
      )}
    </Panel>
  )
}
