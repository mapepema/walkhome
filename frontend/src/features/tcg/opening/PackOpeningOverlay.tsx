import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, Check, Loader2, RotateCcw, Sparkles, Volume2, VolumeX, X } from "lucide-react"
import { useTcg } from "../store"
import { usePackSet } from "../hooks/usePackSet"
import { detectQuality } from "../lib/quality"
import { rarityMeta } from "../rarity"
import type { CardDef, OpenResult, OpenedCard, PackGrant, Rarity } from "../types"
import { HoloCard } from "../components/HoloCard"
import { CardDetailDialog } from "../components/CardDetailDialog"
import { OpeningScene, type OpeningPhase } from "./OpeningScene"
import { haptic, setSoundEnabled, sfxFlip, sfxReveal, soundEnabled } from "./sfx"
import { COMMIT, useTear } from "./useTear"
import "../tcg.css"

export interface PackOpeningOverlayProps {
  grant: PackGrant
  onDone: () => void
}

export function PackOpeningOverlay({ grant, onDone }: PackOpeningOverlayProps) {
  const [current, setCurrent] = useState(grant)
  const packs = useTcg((s) => s.packs)
  const nextGrant = useMemo(() => packs?.unopened.find((g) => g.id !== current.id && g.id !== grant.id) ?? null, [packs, current.id, grant.id])
  return createPortal(
    <OpeningSession
      key={current.id}
      grant={current}
      remaining={packs ? packs.unopened.filter((g) => g.id !== current.id).length : 0}
      onNext={nextGrant ? () => setCurrent(nextGrant) : undefined}
      onDone={onDone}
    />,
    document.body,
  )
}

const FLASH: Record<Rarity, number> = { common: 0, uncommon: 0.12, rare: 0.35, holo: 0.55, ultra: 0.8, secret: 1 }

interface SessionProps {
  grant: PackGrant
  remaining: number
  onNext?: () => void
  onDone: () => void
}

function OpeningSession({ grant, remaining, onNext, onDone }: SessionProps) {
  const quality = useMemo(() => detectQuality(), [])
  const { set, catalog } = usePackSet(grant)
  const openPack = useTcg((s) => s.openPack)
  const pending = useTcg((s) => s.pending)
  const setPending = useTcg((s) => s.setPending)
  const resumed = pending && pending.grant.id === grant.id ? pending.result : null

  const [phase, setPhase] = useState<OpeningPhase>(resumed ? "ejecting" : "intro")
  const [result, setResult] = useState<OpenResult | null>(resumed)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [burst, setBurst] = useState<{ key: number; rarity: Rarity } | null>(null)
  const [flash, setFlash] = useState<{ key: number; color: string; peak: number } | null>(null)
  const [shaking, setShaking] = useState(false)
  const [sound, setSound] = useState(soundEnabled)
  const [onlyNew, setOnlyNew] = useState(false)
  const [detail, setDetail] = useState<CardDef | null>(null)
  const [announce, setAnnounce] = useState("")
  const started = useRef(false)

  const art = useMemo(
    () => ({
      accent: set?.accent ?? "#d9b25f",
      title: set?.name ?? "Walkhome",
      subtitle: "Pack",
      cards: catalog?.pack.cards_per_pack ?? 5,
    }),
    [set, catalog],
  )

  const startOpen = useCallback(() => {
    if (started.current) return
    started.current = true
    setPhase("ejecting")
    setError(null)
    openPack(grant)
      .then(setResult)
      .catch((e: unknown) => {
        started.current = false
        setError(e instanceof Error ? e.message : "Connection failed")
      })
  }, [grant, openPack])

  const { tear, handlers, autoTear } = useTear(phase === "intro", startOpen, resumed ? 1 : 0)

  // The cards slide out of the wrapper, then the reveal starts.
  useEffect(() => {
    if (phase !== "ejecting" || !result) return
    const id = setTimeout(() => setPhase("revealing"), quality.reducedMotion ? 400 : 1700)
    return () => clearTimeout(id)
  }, [phase, result, quality.reducedMotion])

  const cards: OpenedCard[] = result?.cards ?? []
  const cur = cards[index]

  const finish = useCallback(() => {
    setPending(null)
    setPhase("summary")
  }, [setPending])

  const flip = useCallback(() => {
    if (phase !== "revealing" || !cur) return
    if (!flipped) {
      setFlipped(true)
      const r = cur.card.rarity
      sfxFlip()
      sfxReveal(r)
      haptic(r)
      setBurst({ key: Date.now(), rarity: r })
      if (FLASH[r] > 0) setFlash({ key: Date.now(), color: rarityMeta(r).color, peak: FLASH[r] })
      if ((r === "ultra" || r === "secret") && !quality.reducedMotion) {
        setShaking(true)
        setTimeout(() => setShaking(false), 650)
      }
      setAnnounce(`Card ${index + 1} of ${cards.length}: ${cur.card.name}, ${rarityMeta(r).label}${cur.is_new ? ", new" : `, copy ${cur.count}`}`)
    } else if (index + 1 >= cards.length) {
      finish()
    } else {
      setIndex(index + 1)
      setFlipped(false)
      setAnnounce("")
    }
  }, [phase, cur, flipped, index, cards.length, finish, quality.reducedMotion])

  // Keyboard: Enter / Space to advance, Escape to skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (detail) return
      if (e.key === "Escape") {
        if (phase === "revealing") finish()
        else if (phase === "summary" || phase === "intro") onDone()
      }
      if ((e.key === "Enter" || e.key === " ") && phase === "revealing" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        flip()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [phase, flip, finish, onDone, detail])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const accent = flipped && cur ? rarityMeta(cur.card.rarity).color : art.accent
  const newCount = cards.filter((c) => c.is_new).length
  const essenceTotal = cards.reduce((a, c) => a + c.essence_gained, 0)
  const shown = onlyNew ? cards.filter((c) => c.is_new) : cards
  const waiting = phase === "ejecting" && !result && !error

  return (
    <div
      className={`tcg-root fixed inset-0 z-[90] overflow-hidden ${shaking ? "tcg-shake" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Pack opening"
      style={{
        background: `radial-gradient(80% 60% at 50% 45%, ${accent}38, transparent 70%), radial-gradient(60% 40% at 50% 100%, ${art.accent}22, transparent 70%), #05060a`,
        transition: "background .6s",
      }}
    >
      <div className="sr-only" aria-live="assertive">{announce}</div>

      {phase !== "summary" && (
        <div
          className={`absolute inset-0 ${phase === "intro" ? "touch-none cursor-grab" : ""}`}
          {...(phase === "intro" ? handlers : {})}
        >
          <OpeningScene
            phase={phase}
            art={art}
            coverUrl={set?.cover}
            tear={tear}
            cards={result ? cards.map((c) => c.card) : null}
            index={index}
            flipped={flipped}
            burst={burst}
            quality={quality}
            onFlip={flip}
          />
        </div>
      )}

      {flash && <div key={flash.key} className="tcg-flash" style={{ background: `radial-gradient(circle at 50% 50%, ${flash.color}, transparent 75%)`, ["--peak" as string]: flash.peak }} />}

      {/* top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          className="tcg-btn tcg-btn--ghost pointer-events-auto !min-h-11 !w-11 !p-0"
          aria-label={phase === "revealing" ? "Skip the reveal" : "Close"}
          onClick={() => (phase === "revealing" ? finish() : onDone())}
        >
          <X size={20} />
        </button>
        <button
          className="tcg-btn tcg-btn--ghost pointer-events-auto !min-h-11 !w-11 !p-0"
          aria-label={sound ? "Mute sound" : "Enable sound"}
          aria-pressed={sound}
          onClick={() => {
            setSoundEnabled(!sound)
            setSound(!sound)
          }}
        >
          {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
      </div>

      {/* intro: wrapper */}
      {phase === "intro" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))] px-6 text-center">
            <p className="text-[11px] uppercase tracking-[0.3em]" style={{ color: "var(--tcg-muted)" }}>{grant.title}</p>
            <h1 className="mt-1 text-xl font-semibold">{tear >= COMMIT ? "Keep going…" : "Swipe to open"}</h1>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/15" aria-hidden>
              <div className="h-full rounded-full" style={{ width: `${tear * 100}%`, background: art.accent }} />
            </div>
            <button className="tcg-btn w-full max-w-xs" onClick={autoTear}>
              <Sparkles size={16} /> Open the pack
            </button>
          </div>
        </>
      )}

      {/* waiting / network error */}
      {phase === "ejecting" && (waiting || error) && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {error ? (
            <div className="tcg-glass flex max-w-sm flex-col items-center gap-3 p-4 text-center" role="alert">
              <p className="font-semibold">Connection interrupted</p>
              <p className="text-sm" style={{ color: "var(--tcg-muted)" }}>{error}. Your pack is not lost: the draw is kept on the server.</p>
              <div className="flex gap-2">
                <button className="tcg-btn" onClick={startOpen}><RotateCcw size={16} /> Retry</button>
                <button className="tcg-btn tcg-btn--ghost" onClick={onDone}>Later</button>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm" style={{ color: "var(--tcg-muted)" }}><Loader2 className="animate-spin" size={16} /> Drawing your cards…</p>
          )}
        </div>
      )}

      {/* reveal */}
      {phase === "revealing" && cur && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-[max(3.5rem,calc(env(safe-area-inset-top)+3rem))] flex flex-col items-center gap-2 px-6 text-center">
            <div className="flex gap-1.5" aria-hidden>
              {cards.map((c, i) => (
                <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === index ? 22 : 8, background: i < index || (i === index && flipped) ? rarityMeta(c.card.rarity).color : "rgba(255,255,255,.22)" }} />
              ))}
            </div>
            <AnimatePresence mode="wait">
              {flipped ? (
                <motion.div key={`n-${index}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-1">
                  <h2 className="text-2xl font-bold" style={{ textShadow: `0 0 24px ${rarityMeta(cur.card.rarity).color}` }}>{cur.card.name}</h2>
                  <span className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: rarityMeta(cur.card.rarity).color }}>{rarityMeta(cur.card.rarity).label}</span>
                </motion.div>
              ) : (
                <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm" style={{ color: "var(--tcg-muted)" }}>
                  Card {index + 1} of {cards.length}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {flipped && (
              <div className="tcg-new flex flex-wrap items-center justify-center gap-2" key={`b-${index}`}>
                {cur.is_new ? (
                  <span className="rounded-full px-3 py-1 text-xs font-extrabold tracking-wider text-[#1a1305]" style={{ background: "linear-gradient(135deg,#fff3b0,#ffb830)" }}>NEW!</span>
                ) : (
                  <span className="tcg-chip !cursor-default">×{cur.count} copies</span>
                )}
                {cur.essence_gained > 0 && <span className="tcg-chip !cursor-default" style={{ color: "var(--tcg-gold-2)" }}>+{cur.essence_gained} ✦ essence</span>}
              </div>
            )}
            <button className="tcg-btn w-full max-w-xs" onClick={flip}>
              {!flipped ? "Reveal" : index + 1 >= cards.length ? <><Check size={16} /> See the summary</> : <>Next <ArrowRight size={16} /></>}
            </button>
          </div>
        </>
      )}

      {/* summary */}
      {phase === "summary" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 flex flex-col overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))]">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
            <div className="text-center">
              <h1 className="text-2xl font-bold">Pack summary</h1>
              <p className="mt-1 text-sm" style={{ color: "var(--tcg-muted)" }}>
                {newCount > 0 ? `${newCount} new card${newCount > 1 ? "s" : ""}` : "No new cards"}
                {essenceTotal > 0 && <> · <span style={{ color: "var(--tcg-gold-2)" }}>+{essenceTotal} ✦ essence</span></>}
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <button className="tcg-chip" aria-pressed={!onlyNew} onClick={() => setOnlyNew(false)}>All ({cards.length})</button>
              <button className="tcg-chip" aria-pressed={onlyNew} onClick={() => setOnlyNew(true)} disabled={newCount === 0}>New ({newCount})</button>
            </div>
            <div className="grid grid-cols-3 justify-items-center gap-x-3 gap-y-5 py-2 sm:grid-cols-5">
              {shown.map((c, i) => (
                <motion.div key={`${c.card.id}-${i}`} initial={{ opacity: 0, y: 18, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.06 }} className="flex w-full flex-col items-center gap-1.5">
                  <HoloCard card={c.card} size="md" fluid className="!max-w-[150px]" onClick={() => setDetail(c.card)} count={c.count} hires />
                  <div className="flex flex-wrap justify-center gap-1 text-[10px] font-bold">
                    {c.is_new ? <span className="rounded-full px-2 py-0.5 text-[#1a1305]" style={{ background: "linear-gradient(135deg,#fff3b0,#ffb830)" }}>NEW</span> : <span className="rounded-full bg-white/10 px-2 py-0.5">×{c.count}</span>}
                    {c.essence_gained > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5" style={{ color: "var(--tcg-gold-2)" }}>+{c.essence_gained}✦</span>}
                  </div>
                </motion.div>
              ))}
            </div>
            {!!result?.granted?.length && (
              <p className="tcg-glass mx-auto px-4 py-2 text-center text-sm font-semibold" style={{ color: "var(--tcg-gold-2)" }}>
                Album milestone reached: +{result.granted.length} pack{result.granted.length > 1 ? "s" : ""} awarded!
              </p>
            )}
            <div className="mt-auto flex flex-col items-center gap-2 pt-2">
              {onNext && (
                <button className="tcg-btn w-full max-w-xs" onClick={onNext}>
                  <Sparkles size={16} /> Next pack ({remaining} left)
                </button>
              )}
              <button className={`tcg-btn w-full max-w-xs ${onNext ? "tcg-btn--ghost" : ""}`} onClick={onDone}>Done</button>
            </div>
          </div>
        </motion.div>
      )}

      {detail && <CardDetailDialog card={detail} cards={cards.map((c) => c.card)} onClose={() => setDetail(null)} />}
    </div>
  )
}
