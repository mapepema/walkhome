import { useCallback, useEffect, useRef, useState } from "react"
import { api, errMsg } from "./api"
import { useStore } from "./store"

export interface Query<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  setData: (v: T | null | ((p: T | null) => T | null)) => void
}

const cache = new Map<string, unknown>()

/** Minimal stale-while-revalidate fetcher. `path` null = disabled.
 * Re-fetches when the store's dataVersion bumps (reward, rank, event…). */
export function useApi<T>(
  path: string | null,
  opts: { refreshMs?: number; watch?: boolean } = {},
): Query<T> {
  const version = useStore((s) => s.dataVersion)
  const [data, setData] = useState<T | null>(() => (path ? ((cache.get(path) as T) ?? null) : null))
  const [loading, setLoading] = useState(!!path && !cache.has(path))
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const pathRef = useRef(path)
  pathRef.current = path

  const watchVersion = opts.watch === false ? 0 : version

  useEffect(() => {
    if (!path) return
    const ac = new AbortController()
    if (!cache.has(path)) setLoading(true)
    else setData(cache.get(path) as T)
    api<T>(path, { signal: ac.signal })
      .then((d) => {
        cache.set(path, d)
        setData(d)
        setError(null)
      })
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setError(errMsg(e))
      })
      .finally(() => setLoading(false))
    return () => ac.abort()
  }, [path, tick, watchVersion])

  useEffect(() => {
    if (!opts.refreshMs || !path) return
    const id = setInterval(() => setTick((t) => t + 1), opts.refreshMs)
    return () => clearInterval(id)
  }, [opts.refreshMs, path])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload, setData }
}

export function clearApiCache() {
  cache.clear()
}

/** Counts up to `to` (ease-out). Respects reduced motion. */
export function useCountUp(to: number, ms = 900): number {
  const [v, setV] = useState(to)
  const from = useRef(to)
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setV(to)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const e = 1 - (1 - p) ** 3
      setV(a + (to - a) * e)
      if (p < 1) raf = requestAnimationFrame(step)
      else from.current = to
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, ms])
  return v
}

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const f = () => setM(mq.matches)
    mq.addEventListener("change", f)
    return () => mq.removeEventListener("change", f)
  }, [query])
  return m
}
