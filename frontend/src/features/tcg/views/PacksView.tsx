import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { BookOpen, Flag, Flame, Footprints, Gift, Scroll, Sparkles, Sun, Trophy, RotateCcw } from "lucide-react"
import { useTcg } from "../store"
import type { PackGrant } from "../types"
import { PackOpeningOverlay } from "../opening/PackOpeningOverlay"
import "../tcg.css"

const SOURCES: Record<string, { label: string; icon: typeof Gift; text: string }> = {
  distance: { label: "Distance", icon: Footprints, text: "1 pack every 2 km walked" },
  daily: { label: "First km of the day", icon: Sun, text: "One pack for the first kilometre of the day" },
  streak: { label: "Streak", icon: Flame, text: "Tiers at 3, 7, 14, 30, 60 and 100 days" },
  quest: { label: "Quests", icon: Scroll, text: "Claim your daily and weekly quests" },
  milestone: { label: "Journey milestones", icon: Flag, text: "Every stage reached on the road" },
  album: { label: "Album", icon: BookOpen, text: "At 25, 50, 75 and 100% of a set" },
  rank: { label: "Leaderboard", icon: Trophy, text: "Overtake a player or make the podium" },
  welcome: { label: "Welcome", icon: Gift, text: "2 packs offered at sign-up" },
}
const sourceMeta = (s: string) => SOURCES[s] ?? { label: s, icon: Gift, text: "" }

function fmtDistance(m: number) {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(1)} km`
}

function PackCard({ grant, accent, focus, onClick }: { grant: PackGrant; accent: string; focus: boolean; onClick: () => void }) {
  const meta = sourceMeta(grant.source)
  return (
    <button
      className="tcg-pack"
      data-focus={focus}
      style={{ "--accent": accent } as CSSProperties}
      onClick={onClick}
      aria-label={`Open the pack: ${grant.title}`}
    >
      <span className="tcg-pack__shine" />
      <span className="absolute inset-x-0 top-[3%] text-center text-[9px] font-bold uppercase tracking-[0.25em] opacity-70">Tear here</span>
      <span className="absolute inset-x-0 top-[44%] grid place-items-center">
        <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-white/80 bg-black/50 text-3xl font-black tcg-display">W</span>
      </span>
      <span className="absolute inset-x-2 bottom-[10%] text-center">
        <span className="tcg-display block text-[17px] font-extrabold leading-tight">PACK</span>
        <span className="mt-1 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
          <meta.icon size={11} /> {meta.label}
        </span>
      </span>
    </button>
  )
}

export function PacksView() {
  const packs = useTcg((s) => s.packs)
  const error = useTcg((s) => s.error)
  const pending = useTcg((s) => s.pending)
  const catalog = useTcg((s) => s.catalog)
  const refreshAll = useTcg((s) => s.refreshAll)
  const loadCatalog = useTcg((s) => s.loadCatalog)
  const [opening, setOpening] = useState<PackGrant | null>(null)
  const [focus, setFocus] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refreshAll()
    void loadCatalog()
  }, [refreshAll, loadCatalog])

  const unopened = useMemo(() => packs?.unopened ?? [], [packs])
  const everyM = packs?.pack_every_m ?? 2000
  const nextM = packs?.next_pack_in_m ?? everyM
  const progress = Math.min(1, Math.max(0, 1 - nextM / everyM))
  const accentFor = (g: PackGrant) => (catalog && catalog.theme === g.theme ? catalog.sets[g.id % Math.max(1, catalog.sets.length)]?.accent : undefined) ?? "#d9b25f"
  const resume = pending && !unopened.some((g) => g.id === pending.grant.id) ? pending.grant : null

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const child = el.firstElementChild as HTMLElement | null
    const step = child ? child.offsetWidth + 16 : 200
    setFocus(Math.max(0, Math.min(unopened.length - 1, Math.round(el.scrollLeft / step))))
  }
  const current = unopened[focus]

  return (
    <div className="tcg-root mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 rounded-3xl p-4 pb-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">My packs</h1>
          <p className="text-sm" style={{ color: "var(--tcg-muted)" }}>
            {unopened.length > 0 ? `${unopened.length} ready to open` : "No packs waiting"}
            {packs ? ` · ${packs.opened_count} opened` : ""}
          </p>
        </div>
      </header>

      {error && !packs && (
        <div className="tcg-glass flex items-center justify-between gap-3 p-4" role="alert">
          <span className="text-sm">{error}</span>
          <button className="tcg-btn tcg-btn--ghost" onClick={() => void refreshAll()}><RotateCcw size={16} /> Retry</button>
        </div>
      )}

      {resume && (
        <div className="tcg-glass flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-semibold">Reveal interrupted</p>
            <p className="text-sm" style={{ color: "var(--tcg-muted)" }}>Your draw is saved: pick up where you left off.</p>
          </div>
          <button className="tcg-btn" onClick={() => setOpening(resume)}><Sparkles size={16} /> Resume</button>
        </div>
      )}

      {unopened.length > 0 ? (
        <section aria-label="Packs ready" className="flex flex-col items-center gap-4">
          <div
            ref={scroller}
            onScroll={onScroll}
            className="tcg-scroll-hide flex w-full snap-x snap-mandatory gap-4 overflow-x-auto px-[calc(50%-95px)] py-6"
            style={{ perspective: 900, scrollSnapType: "x mandatory" }}
          >
            {unopened.map((g, i) => (
              <PackCard key={g.id} grant={g} accent={accentFor(g)} focus={i === focus} onClick={() => setOpening(g)} />
            ))}
          </div>
          {current && (
            <div className="text-center">
              <p className="text-lg font-semibold">{current.title}</p>
              <p className="text-xs" style={{ color: "var(--tcg-muted)" }}>
                {sourceMeta(current.source).label} · {new Date(current.created_utc).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
              </p>
            </div>
          )}
          <button className="tcg-btn !min-h-12 w-full max-w-xs text-base" onClick={() => current && setOpening(current)}>
            <Sparkles size={18} /> Open this pack
          </button>
        </section>
      ) : (
        <section className="tcg-glass flex flex-col items-center gap-4 p-8 text-center">
          <div className="relative">
            <div className="tcg-pack !cursor-default" data-focus="true" style={{ "--accent": "#d9b25f", width: 120, opacity: 0.55 } as CSSProperties}>
              <span className="tcg-pack__shine" />
            </div>
          </div>
          <h2 className="text-xl font-bold">Your next pack is waiting on the road</h2>
          <p className="max-w-sm text-sm" style={{ color: "var(--tcg-muted)" }}>
            Every {fmtDistance(everyM)} walked earns a card pack. Start the treadmill and move your journey forward.
          </p>
        </section>
      )}

      <section className="tcg-glass flex flex-col gap-3 p-4" aria-label="Next pack">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-semibold"><Footprints size={16} style={{ color: "var(--tcg-gold)" }} /> Next pack in {fmtDistance(nextM)}</span>
          <span style={{ color: "var(--tcg-muted)" }}>{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progress * 100}%`, background: "linear-gradient(90deg, #a67c2e, #f3dc9d)", boxShadow: "0 0 12px #d9b25f88" }} />
        </div>
      </section>

      <section aria-label="Reward sources" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">How to earn packs</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(SOURCES).map(([k, s]) => (
            <li key={k} className="tcg-glass flex items-start gap-3 p-3">
              <span className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full" style={{ background: "rgba(217,178,95,.14)", color: "var(--tcg-gold)" }}>
                <s.icon size={17} />
              </span>
              <span>
                <span className="block text-sm font-semibold">{k === "distance" ? `Distance (1 / ${fmtDistance(everyM)})` : s.label}</span>
                <span className="block text-xs" style={{ color: "var(--tcg-muted)" }}>{s.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {opening && (
        <PackOpeningOverlay
          grant={opening}
          onDone={() => {
            setOpening(null)
            void refreshAll()
          }}
        />
      )}
    </div>
  )
}
