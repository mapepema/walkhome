import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { haptic, sfxTear } from "./sfx"

export const COMMIT = 0.45

/**
 * Tear gesture: the progress follows the finger (not a triggered animation).
 * Past COMMIT the tear finishes on its own; below it the wrapper closes again.
 * `autoTear()` takes the same path without a gesture (accessible button / keyboard).
 */
export function useTear(enabled: boolean, onCommit: () => void, startAt = 0) {
  const [tear, setTear] = useState(startAt)
  const start = useRef<{ x: number; base: number } | null>(null)
  const committed = useRef(startAt >= 1)
  const passed = useRef(false)
  const settleTo = useRef<number | null>(null)
  const live = useRef(startAt)
  const cb = useRef(onCommit)
  useEffect(() => {
    cb.current = onCommit
  })

  useEffect(() => {
    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const target = settleTo.current
      if (target === null) return
      const value = live.current + (target - live.current) * 0.16
      const done = Math.abs(target - value) < 0.005
      live.current = done ? target : value
      setTear(live.current)
      if (done) {
        settleTo.current = null
        if (target === 1 && !committed.current) {
          committed.current = true
          haptic("rare")
          cb.current()
        }
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const release = () => {
    if (!start.current) return
    start.current = null
    settleTo.current = live.current >= COMMIT ? 1 : 0
    if (live.current >= COMMIT) sfxTear()
    else passed.current = false
  }

  const autoTear = useCallback(() => {
    if (committed.current) return
    sfxTear()
    settleTo.current = 1
  }, [])

  const handlers = enabled
    ? {
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
          if (committed.current) return
          start.current = { x: e.clientX, base: live.current }
          settleTo.current = null
          e.currentTarget.setPointerCapture(e.pointerId)
        },
        onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
          if (!start.current || committed.current) return
          const span = e.currentTarget.clientWidth * 0.7
          const value = Math.max(0, Math.min(1, start.current.base + (e.clientX - start.current.x) / span))
          if (!passed.current && value >= COMMIT) {
            passed.current = true
            haptic("tick")
          }
          live.current = value
          setTear(value)
        },
        onPointerUp: release,
        onPointerCancel: release,
      }
    : {}

  return { tear, handlers, autoTear }
}
