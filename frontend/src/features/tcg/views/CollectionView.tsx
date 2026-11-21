import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, Gem, RotateCcw, Search } from "lucide-react"
import { useTcg } from "../store"
import { useCatalog } from "../hooks/useCatalog"
import { useVirtualGrid } from "../hooks/useVirtualGrid"
import { RARITIES, RARITY_ORDER, rarityMeta } from "../rarity"
import type { CardDef, Rarity } from "../types"
import { HoloCard } from "../components/HoloCard"
import { CardDetailDialog } from "../components/CardDetailDialog"
import "../tcg.css"

type Status = "all" | "owned" | "missing"
type Sort = "number" | "rarity" | "name" | "count"

const MILESTONES = [25, 50, 75, 100]

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v)
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms)
    return () => clearTimeout(id)
  }, [v, ms])
  return d
}

export function CollectionView() {
  const { catalog, cards, sets, loading, error, reload } = useCatalog()
  const collection = useTcg((s) => s.collection)
  const loadCollection = useTcg((s) => s.loadCollection)
  const [setId, setSetId] = useState<string>("all")
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set())
  const [status, setStatus] = useState<Status>("all")
  const [sort, setSort] = useState<Sort>("number")
  const [query, setQuery] = useState("")
  const q = useDebounced(query.trim().toLowerCase(), 150)
  const [detail, setDetail] = useState<CardDef | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadCollection()
  }, [loadCollection])

  const owned = collection?.owned
  const countOf = useCallback((id: string) => owned?.[id]?.count ?? 0, [owned])

  const filtered = useMemo(() => {
    let list = cards
    if (setId !== "all") list = list.filter((c) => c.set === setId)
    if (rarities.size) list = list.filter((c) => rarities.has(c.rarity))
    if (status === "owned") list = list.filter((c) => countOf(c.id) > 0)
    else if (status === "missing") list = list.filter((c) => countOf(c.id) === 0)
    if (q) list = list.filter((c) => countOf(c.id) > 0 ? c.name.toLowerCase().includes(q) || (c.type ?? "").toLowerCase().includes(q) : String(c.number) === q)
    const out = [...list]
    if (sort === "number") out.sort((a, b) => a.set.localeCompare(b.set) || a.number - b.number)
    else if (sort === "rarity") out.sort((a, b) => rarityMeta(b.rarity).rank - rarityMeta(a.rarity).rank || a.number - b.number)
    else if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "en"))
    else out.sort((a, b) => countOf(b.id) - countOf(a.id) || a.number - b.number)
    return out
  }, [cards, setId, rarities, status, q, sort, countOf])

  const grid = useVirtualGrid(gridRef, filtered.length, { minW: 98, gap: 10, aspect: 672 / 480 })

  // progress
  const setStats = useMemo(() => {
    const m = new Map<string, { owned: number; total: number }>()
    for (const s of sets) {
      const c = collection?.completion?.[s.id]
      if (c) m.set(s.id, c)
      else {
        const inSet = cards.filter((x) => x.set === s.id)
        m.set(s.id, { owned: inSet.filter((x) => countOf(x.id) > 0).length, total: s.card_count || inSet.length })
      }
    }
    return m
  }, [sets, collection, cards, countOf])
  const totals = useMemo(() => {
    let o = 0
    let t = 0
    for (const v of setStats.values()) {
      o += v.owned
      t += v.total
    }
    return { owned: o, total: t }
  }, [setStats])
  const active = setId === "all" ? totals : (setStats.get(setId) ?? { owned: 0, total: 0 })
  const pct = active.total ? (active.owned / active.total) * 100 : 0
  const activeSet = sets.find((s) => s.id === setId)
  const nextMs = MILESTONES.find((m) => pct < m)

  const toggleRarity = (r: Rarity) =>
    setRarities((p) => {
      const n = new Set(p)
      if (n.has(r)) n.delete(r)
      else n.add(r)
      return n
    })

  const rows: number[] = []
  for (let r = grid.first; r <= grid.last; r++) rows.push(r)

  return (
    <div className="tcg-root mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 rounded-3xl p-4 pb-10">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Collection</h1>
          <p className="text-sm" style={{ color: "var(--tcg-muted)" }}>
            {totals.owned} / {totals.total} cards{filtered.length !== cards.length ? ` · ${filtered.length} shown` : ""}
          </p>
        </div>
        <div className="tcg-glass flex items-center gap-2 px-3 py-2" title="Essence: earned from duplicates, spent on crafting" aria-label={`Essence: ${collection?.essence ?? 0}`}>
          <Gem size={16} style={{ color: "var(--tcg-gold)" }} />
          <strong className="tabular-nums">{collection?.essence ?? 0}</strong>
          <span className="text-xs" style={{ color: "var(--tcg-muted)" }}>essence</span>
        </div>
      </header>

      {/* sets */}
      <nav className="tcg-scroll-hide -mx-4 flex gap-2 overflow-x-auto px-4" aria-label="Sets">
        <button className="tcg-chip" aria-pressed={setId === "all"} onClick={() => setSetId("all")}>All</button>
        {sets.map((s) => {
          const st = setStats.get(s.id)
          return (
            <button key={s.id} className="tcg-chip" aria-pressed={setId === s.id} onClick={() => setSetId(s.id)}>
              <span className="h-2 w-2 rounded-full" style={{ background: s.accent }} />
              {s.name} <span className="opacity-70">{st?.owned ?? 0}/{st?.total ?? s.card_count}</span>
            </button>
          )
        })}
      </nav>

      {/* progress + milestones */}
      <section className="tcg-glass flex flex-col gap-2 p-4" aria-label="Album progress">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">{activeSet?.name ?? "All sets"}</span>
          <span style={{ color: "var(--tcg-muted)" }}>{active.owned} / {active.total} · {Math.round(pct)}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-white/10">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${activeSet?.accent ?? "#a67c2e"}, #f3dc9d)`, boxShadow: `0 0 14px ${activeSet?.accent ?? "#d9b25f"}88` }} />
          {MILESTONES.map((m) => (
            <span
              key={m}
              className="absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border text-[9px] font-bold"
              style={{
                left: `${m}%`,
                marginLeft: m === 100 ? -10 : 0,
                background: pct >= m ? "var(--tcg-gold)" : "#161922",
                borderColor: pct >= m ? "var(--tcg-gold-2)" : "var(--tcg-line)",
                color: pct >= m ? "#1a1305" : "var(--tcg-muted)",
              }}
              title={`${m}% milestone: pack awarded`}
            >
              {pct >= m ? <Check size={11} /> : ""}
            </span>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--tcg-muted)" }}>
          {nextMs && setId !== "all"
            ? `Next milestone at ${nextMs}%: ${Math.max(1, Math.ceil((nextMs / 100) * active.total) - active.owned)} more card(s) to earn a pack.`
            : setId === "all"
              ? "Pick a set to follow its milestones (25 / 50 / 75 / 100%): each one awards a pack."
              : "Album complete. Well done!"}
        </p>
      </section>

      {/* filters */}
      <section className="flex flex-col gap-2" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-2">
          <label className="tcg-glass relative flex min-w-[180px] flex-1 items-center gap-2 !rounded-full px-3">
            <Search size={16} style={{ color: "var(--tcg-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a card…"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-white/35"
              aria-label="Search"
              type="search"
            />
          </label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort"
            className="tcg-chip !min-h-11 !rounded-xl"
            style={{ background: "#14161d" }}
          >
            <option value="number">Sort: number</option>
            <option value="rarity">Sort: rarity</option>
            <option value="name">Sort: name</option>
            <option value="count">Sort: copies</option>
          </select>
        </div>
        <div className="tcg-scroll-hide -mx-4 flex gap-2 overflow-x-auto px-4">
          {(["all", "owned", "missing"] as Status[]).map((s) => (
            <button key={s} className="tcg-chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s === "all" ? "All" : s === "owned" ? "Owned" : "Missing"}
            </button>
          ))}
          <span className="mx-1 w-px flex-none bg-white/10" />
          {RARITY_ORDER.map((r) => (
            <button key={r} className="tcg-chip" aria-pressed={rarities.has(r)} onClick={() => toggleRarity(r)} style={rarities.has(r) ? { background: RARITIES[r].color, color: "#10100f" } : undefined}>
              {RARITIES[r].label}
            </button>
          ))}
        </div>
      </section>

      {/* grid */}
      {error && (
        <div className="tcg-glass flex items-center justify-between gap-3 p-4" role="alert">
          <span className="text-sm">{error}</span>
          <button className="tcg-btn tcg-btn--ghost" onClick={reload}><RotateCcw size={16} /> Retry</button>
        </div>
      )}
      {loading && !catalog && (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5" aria-busy>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-white/5" style={{ aspectRatio: "480/672" }} />
          ))}
        </div>
      )}
      {catalog && filtered.length === 0 && (
        <p className="py-10 text-center text-sm" style={{ color: "var(--tcg-muted)" }}>No card matches these filters.</p>
      )}
      <div ref={gridRef} style={{ position: "relative", height: grid.totalH, contain: "layout paint" }} role="list" aria-label="Cards">
        {rows.map((r) => (
          <div
            key={r}
            role="presentation"
            style={{
              position: "absolute",
              top: r * grid.rowH,
              left: 0,
              right: 0,
              display: "grid",
              gridTemplateColumns: `repeat(${grid.cols}, ${grid.cellW}px)`,
              gap: 10,
              height: grid.rowH - 10,
            }}
          >
            {filtered.slice(r * grid.cols, (r + 1) * grid.cols).map((c) => {
              const n = countOf(c.id)
              return (
                <div role="listitem" key={c.id}>
                  <HoloCard card={c} size="md" fluid owned={n > 0} count={n} onClick={() => setDetail(c)} interactive={n > 0} />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {detail && <CardDetailDialog card={detail} cards={filtered} onClose={() => setDetail(null)} />}
    </div>
  )
}
