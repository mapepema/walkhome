import { useState } from "react"
import { Flame, Layers, MapPin, Sparkles } from "lucide-react"
import { useApi } from "@/lib/hooks"
import { back } from "@/lib/router"
import { fmtDist } from "@/lib/format"
import { selUnits, useStore } from "@/lib/store"
import type { CardDef, PublicProfileFull } from "@/lib/types"
import { CardDetailDialog, HoloCard } from "@/lib/tcg"
import { Sheet } from "@/kit/Sheet"
import { Avatar, Bar, Chip, EmptyState, ErrorLine, Skeleton } from "@/kit/ui"

export function ProfileDrawer({ id }: { id: number | null }) {
  const { data, error, loading } = useApi<PublicProfileFull>(id ? `/users/${id}/profile` : null, { watch: false })
  const units = useStore(selUnits)
  const [card, setCard] = useState<CardDef | null>(null)
  const p = data && data.id === id ? data : null
  return (
    <>
      <Sheet open={id != null} onClose={() => back("race")} title={p?.display_name ?? "Profile"} hideTitle variant="side">
        {error && <ErrorLine message={error} />}
        {loading && !p && <div className="flex flex-col gap-3"><Skeleton className="mx-auto size-24 rounded-full" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
        {p && (
          <div className="pb-4 text-center">
            <div className="mx-auto w-fit"><Avatar emoji={p.avatar} color={p.color} size={92} ring live={p.walking_now} /></div>
            <h2 className="font-display mt-3 text-2xl font-bold">{p.display_name}</h2>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <span>@{p.username}</span>
              {p.walking_now && <Chip tone="win">walking</Chip>}
            </div>
            <div className="glass mt-5 p-4 text-left">
              <div className="eyebrow flex items-center gap-1.5"><MapPin className="size-3" /> {p.stage_name ?? "—"}</div>
              <div className="font-display mt-1 text-lg font-semibold">{p.biome_name ?? "—"}</div>
              <Bar value={p.fraction} className="mt-3" />
              <div className="tnum mt-1.5 text-xs text-muted-foreground">{fmtDist(p.progress_m, units, 1)} · {(p.fraction * 100).toFixed(1)}% of the road</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="glass p-3.5"><Flame className="mx-auto size-5 text-orange-400" /><div className="tnum mt-1 text-2xl font-bold">{p.streak_days}</div><div className="eyebrow">streak days</div></div>
              <div className="glass p-3.5"><Sparkles className="mx-auto size-5 text-gold" /><div className="tnum mt-1 text-2xl font-bold">{p.cards_owned}<span className="text-sm text-muted-foreground">/{p.cards_total}</span></div><div className="eyebrow">cards</div></div>
            </div>
            <div className="mt-6 text-left">
              <div className="eyebrow mb-3">Best cards</div>
              {p.recent_rares.length === 0 ? (
                <EmptyState icon={<Layers className="size-6" />} title="No cards yet" body="This player's best pulls will show up here." />
              ) : (
                <div className="snap-x-row -mx-1 px-1 pb-2">
                  {p.recent_rares.map((c) => (
                    <button key={c.id} onClick={() => setCard(c)} aria-label={c.name} className="transition-transform hover:-translate-y-1"><HoloCard card={c} size="md" /></button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>
      {card && <CardDetailDialog card={card} onClose={() => setCard(null)} />}
    </>
  )
}
