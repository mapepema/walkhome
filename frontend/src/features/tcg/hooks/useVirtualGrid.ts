import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"

function scrollParent(el: HTMLElement | null): HTMLElement | Window {
  let p = el?.parentElement ?? null
  while (p) {
    const o = getComputedStyle(p).overflowY
    if ((o === "auto" || o === "scroll" || o === "overlay") && p.scrollHeight > p.clientHeight + 1) return p
    p = p.parentElement
  }
  return window
}

export interface VirtualGrid {
  cols: number
  cellW: number
  rowH: number
  first: number
  last: number
  totalH: number
}

/**
 * Windowing for a card grid (≈ 1,700 entries): only the visible rows
 * (+ overscan) are mounted. Works whether the scrolling element is the page
 * or a parent container.
 */
export function useVirtualGrid(ref: RefObject<HTMLDivElement | null>, count: number, opts: { minW: number; gap: number; aspect: number; overscanPx?: number }): VirtualGrid {
  const { minW, gap, aspect, overscanPx = 700 } = opts
  const [w, setW] = useState(0)
  const [range, setRange] = useState({ off: 0, vh: typeof window === "undefined" ? 800 : window.innerHeight })
  const raf = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sp = scrollParent(el)
    const measure = () => {
      raf.current = 0
      const r = el.getBoundingClientRect()
      const top = sp === window ? 0 : (sp as HTMLElement).getBoundingClientRect().top
      const vh = sp === window ? window.innerHeight : (sp as HTMLElement).clientHeight
      setRange((p) => (Math.abs(p.off - (top - r.top)) < 8 && p.vh === vh ? p : { off: top - r.top, vh }))
    }
    const on = () => {
      if (!raf.current) raf.current = requestAnimationFrame(measure)
    }
    measure()
    sp.addEventListener("scroll", on, { passive: true })
    window.addEventListener("resize", on)
    return () => {
      sp.removeEventListener("scroll", on)
      window.removeEventListener("resize", on)
      cancelAnimationFrame(raf.current)
    }
  }, [ref, count, w])

  const cols = Math.max(2, Math.floor((w + gap) / (minW + gap)))
  const cellW = w > 0 ? (w - gap * (cols - 1)) / cols : minW
  const rowH = cellW * aspect + gap
  const rows = Math.ceil(count / cols)
  const first = Math.max(0, Math.floor((range.off - overscanPx) / rowH))
  const last = Math.min(rows - 1, Math.ceil((range.off + range.vh + overscanPx) / rowH))
  return { cols, cellW, rowH, first, last, totalH: rows * rowH }
}
