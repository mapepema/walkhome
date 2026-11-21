import { useFrame } from "@react-three/fiber"
import { useRef } from "react"

declare global {
  interface Window {
    __tcgPerf?: { calls: number; triangles: number; textures: number; geometries: number; fps: number }
  }
}

/** Performance probe (draw calls, triangles, FPS): enabled with `?perf=1`. */
export function PerfProbe() {
  const acc = useRef({ t: 0, n: 0 })
  const on = typeof location !== "undefined" && new URLSearchParams(location.search).has("perf")
  useFrame((state, dt) => {
    if (!on) return
    acc.current.t += dt
    acc.current.n++
    if (acc.current.t > 1) {
      const i = state.gl.info
      window.__tcgPerf = {
        calls: i.render.calls,
        triangles: i.render.triangles,
        textures: i.memory.textures,
        geometries: i.memory.geometries,
        fps: Math.round(acc.current.n / acc.current.t),
      }
      acc.current = { t: 0, n: 0 }
    }
  })
  return null
}
