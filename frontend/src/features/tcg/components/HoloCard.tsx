import { memo, useRef, type CSSProperties, type KeyboardEvent } from "react"
import type { CardDef, CardSize } from "../types"
import { rarityMeta } from "../rarity"
import "../tcg.css"

export interface HoloCardProps {
  card: CardDef
  size?: CardSize
  /** Tilt on hover (mouse) + highlights. Disable for very large grids. */
  interactive?: boolean
  /** false = silhouette (missing card). */
  owned?: boolean
  /** Number of copies (×N badge when > 1). */
  count?: number
  /** Fills the parent's width (fluid grids). */
  fluid?: boolean
  onClick?: () => void
  className?: string
  /** Loads the full-resolution image (otherwise `thumb`). */
  hires?: boolean
  eager?: boolean
}

const DEFAULT_ART: [number, number, number, number] = [0.1, 0.1, 0.8, 0.5]

/**
 * Lightweight card for grids: 100% CSS (3D tilt + foil gradients masked to
 * `art_rect`). NO WebGL context here: WebGL rendering is reserved for the detail
 * view and the reveal.
 */
export const HoloCard = memo(function HoloCard({
  card,
  size = "md",
  interactive = true,
  owned = true,
  count,
  fluid,
  onClick,
  className,
  hires,
  eager,
}: HoloCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const meta = rarityMeta(card.rarity)
  const [ax, ay, aw, ah] = card.art_rect ?? DEFAULT_ART
  const hasFoil = card.foil !== "none" && owned
  const foilStyle: CSSProperties =
    card.foil === "reverse"
      ? ({ "--ax": `${ax * 100}%`, "--ay": `${ay * 100}%`, "--aw": `${aw * 100}%`, "--ah": `${ah * 100}%` } as CSSProperties)
      : { left: `${ax * 100}%`, top: `${ay * 100}%`, width: `${aw * 100}%`, height: `${ah * 100}%`, borderRadius: "3%" }

  const setPos = (clientX: number, clientY: number) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const py = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`)
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`)
      el.style.setProperty("--rx", `${((0.5 - py) * 16).toFixed(2)}deg`)
      el.style.setProperty("--ry", `${((px - 0.5) * 20).toFixed(2)}deg`)
    })
  }
  const reset = () => {
    const el = ref.current
    if (!el) return
    cancelAnimationFrame(raf.current)
    el.dataset.live = "false"
    for (const k of ["--mx", "--my", "--rx", "--ry"]) el.style.removeProperty(k)
  }

  const key = (e: KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault()
      onClick()
    }
  }

  const interact = interactive && owned
  return (
    <div
      ref={ref}
      className={`tcg-card ${className ?? ""}`}
      data-size={size}
      data-fluid={fluid ? "true" : undefined}
      data-rarity={card.rarity}
      data-foil={owned ? card.foil : "none"}
      data-owned={owned ? "true" : "false"}
      data-live="false"
      style={{ "--accent": meta.color } as CSSProperties}
      role={onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      aria-label={owned ? `${card.name}, ${meta.label}${count && count > 1 ? `, ${count} copies` : ""}` : `Missing card #${card.number}`}
      onClick={onClick}
      onKeyDown={key}
      onPointerEnter={interact ? (e) => e.pointerType === "mouse" && ref.current && (ref.current.dataset.live = "true") : undefined}
      onPointerMove={interact ? (e) => e.pointerType === "mouse" && setPos(e.clientX, e.clientY) : undefined}
      onPointerLeave={interact ? reset : undefined}
    >
      <div className="tcg-card__tilt">
        <img
          className="tcg-card__img"
          src={hires ? card.image : card.thumb}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
        />
        {!owned && (
          <div className="tcg-card__ghost">
            ?<small>#{card.number}</small>
          </div>
        )}
        {hasFoil && <div className="tcg-card__foil" style={foilStyle} />}
        {owned && card.rarity !== "common" && card.rarity !== "uncommon" && <div className="tcg-card__rim" />}
        {owned && card.rarity !== "common" && <div className="tcg-card__glare" />}
        {owned && card.rarity !== "common" && <span className="tcg-card__gem" />}
        {owned && count != null && count > 1 && <span className="tcg-card__count">×{count}</span>}
      </div>
    </div>
  )
})
