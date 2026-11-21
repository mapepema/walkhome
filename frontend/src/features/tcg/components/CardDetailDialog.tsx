import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Sparkles, X, Hammer, Smartphone } from "lucide-react"
import { useTcg } from "../store"
import { craftCost, rarityMeta } from "../rarity"
import type { CardDef } from "../types"
import { enableDeviceTilt, needsMotionPermission, supportsDeviceTilt } from "../lib/tilt"
import { HoloCard } from "./HoloCard"
import "../tcg.css"

const CardScene = lazy(() => import("../scene/CardScene").then((m) => ({ default: m.CardScene })))

export interface CardDetailDialogProps {
  card: CardDef
  onClose: () => void
  /** Navigation list (default: cards from the same set). */
  cards?: CardDef[]
}

function webglOk() {
  try {
    const c = document.createElement("canvas")
    return !!(c.getContext("webgl2") || c.getContext("webgl"))
  } catch {
    return false
  }
}

export function CardDetailDialog({ card: initial, onClose, cards }: CardDetailDialogProps) {
  const catalog = useTcg((s) => s.catalog)
  const collection = useTcg((s) => s.collection)
  const economy = useTcg((s) => s.economy)
  const craft = useTcg((s) => s.craft)
  const loadEconomy = useTcg((s) => s.loadEconomy)

  const list = useMemo(() => {
    if (cards && cards.length) return cards
    if (catalog) return catalog.cards.filter((c) => c.set === initial.set)
    return [initial]
  }, [cards, catalog, initial])

  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((c) => c.id === initial.id)))
  const card = list[index] ?? initial
  const meta = rarityMeta(card.rarity)
  const count = collection?.owned[card.id]?.count ?? 0
  const owned = count > 0
  const setDef = catalog?.sets.find((s) => s.id === card.set)
  const essence = collection?.essence ?? 0
  const cost = craftCost(card.rarity, economy)

  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [gyro, setGyro] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const gl = useMemo(webglOk, [])

  useEffect(() => {
    void loadEconomy()
    closeBtn.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [loadEconomy])

  useEffect(() => {
    setMsg(null)
    setConfirm(false)
  }, [card.id])

  // Gyroscope: automatic on Android/mobile desktop, explicit button on iOS.
  useEffect(() => {
    if (supportsDeviceTilt() && !needsMotionPermission() && window.matchMedia("(pointer: coarse)").matches) {
      void enableDeviceTilt().then(setGyro)
    }
  }, [])

  const go = useCallback(
    (d: number) => setIndex((i) => (i + d + list.length) % list.length),
    [list.length],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") go(-1)
      else if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose])

  const doCraft = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await craft(card.id)
      setMsg("Card crafted!")
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Craft failed")
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  // Horizontal swipe on the info panel: previous / next card.
  const swipe = useRef<number | null>(null)

  const node = (
    <div
      className="tcg-root fixed inset-0 z-[80] flex flex-col md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label={`Card detail: ${card.name}`}
      style={{
        background: `radial-gradient(90% 70% at 50% 35%, ${meta.color}2e, transparent 70%), radial-gradient(60% 50% at 50% 100%, ${meta.color2}22, transparent 70%), #07080c`,
      }}
    >
      <div className="relative min-h-0 flex-1">
        {owned && gl ? (
          <Suspense fallback={<div className="grid h-full place-items-center opacity-60"><Sparkles className="animate-pulse" /></div>}>
            <CardScene key={card.id} card={card} className="!absolute inset-0" />
          </Suspense>
        ) : (
          <div className="grid h-full place-items-center p-6">
            <HoloCard card={card} size="lg" owned={owned} hires interactive eager />
          </div>
        )}

        <button ref={closeBtn} onClick={onClose} aria-label="Close" className="tcg-btn tcg-btn--ghost absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] !min-h-11 !w-11 !p-0">
          <X size={20} />
        </button>
        <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-2">
          {supportsDeviceTilt() && !gyro && owned && (
            <button
              className="tcg-btn tcg-btn--ghost !px-3 text-xs"
              onClick={async () => setGyro(await enableDeviceTilt())}
              aria-label="Enable gyroscope tilt"
            >
              <Smartphone size={16} /> Tilt
            </button>
          )}
          <span className="tcg-chip" aria-live="polite">{index + 1} / {list.length}</span>
        </div>
        {list.length > 1 && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous card" className="tcg-btn tcg-btn--ghost absolute left-2 top-1/2 !min-h-11 !w-11 -translate-y-1/2 !p-0 max-md:opacity-70"><ChevronLeft /></button>
            <button onClick={() => go(1)} aria-label="Next card" className="tcg-btn tcg-btn--ghost absolute right-2 top-1/2 !min-h-11 !w-11 -translate-y-1/2 !p-0 max-md:opacity-70"><ChevronRight /></button>
          </>
        )}
      </div>

      <aside
        className="tcg-glass z-10 m-3 flex max-h-[42dvh] flex-col gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:m-4 md:max-h-none md:w-[360px] md:justify-center md:self-center"
        onTouchStart={(e) => (swipe.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (swipe.current == null) return
          const dx = e.changedTouches[0].clientX - swipe.current
          swipe.current = null
          if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1)
        }}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "#10100f", background: `linear-gradient(135deg, ${meta.color}, ${meta.color2})` }}>
            {meta.label}
          </span>
          <span className="text-xs" style={{ color: "var(--tcg-muted)" }}>
            {setDef?.name ?? card.set} · #{card.number}
          </span>
        </div>
        <div>
          <h2 className="text-2xl font-bold leading-tight">{owned ? card.name : "Missing card"}</h2>
          {owned && (card.subtitle || card.type) && <p className="mt-0.5 text-sm" style={{ color: "var(--tcg-muted)" }}>{[card.type, card.subtitle].filter(Boolean).join(" · ")}</p>}
        </div>
        {owned && card.flavor && <p className="border-l-2 pl-3 text-sm italic leading-relaxed" style={{ borderColor: meta.color, color: "var(--tcg-muted)" }}>“{card.flavor}”</p>}
        <div className="flex items-center justify-between text-sm">
          <span style={{ color: "var(--tcg-muted)" }}>Copies</span>
          <strong style={{ color: owned ? "var(--tcg-gold-2)" : "inherit" }}>{owned ? `×${count}` : "None"}</strong>
        </div>
        {owned && card.artist && <p className="text-xs" style={{ color: "var(--tcg-muted)" }}>Artwork: {card.artist}</p>}

        {!owned && (
          <div className="flex flex-col gap-2">
            {cost == null ? (
              <p className="text-xs" style={{ color: "var(--tcg-muted)" }}>Secret cards cannot be crafted: they are only found in packs.</p>
            ) : confirm ? (
              <div className="flex gap-2">
                <button className="tcg-btn flex-1" onClick={doCraft} disabled={busy || essence < cost}>Confirm · {cost} ✦</button>
                <button className="tcg-btn tcg-btn--ghost" onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            ) : (
              <button className="tcg-btn" onClick={() => setConfirm(true)} disabled={essence < cost}>
                <Hammer size={16} /> Craft · {cost} ✦
              </button>
            )}
            {cost != null && <p className="text-xs" style={{ color: "var(--tcg-muted)" }}>Essence: {essence} ✦{essence < cost ? ` — you need ${cost - essence} more` : ""}</p>}
          </div>
        )}
        {msg && <p role="status" className="text-sm font-semibold" style={{ color: "var(--tcg-gold-2)" }}>{msg}</p>}
      </aside>
    </div>
  )
  return createPortal(node, document.body)
}
