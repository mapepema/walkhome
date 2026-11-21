import { useEffect, useMemo, useRef, useState } from "react"
import type { Journey } from "@/lib/types"

export interface MapMarker {
  fraction: number
  avatar: string
  color: string
  label?: string
  me?: boolean
}

/** The journey as one SVG path on a parchment-dark chart; markers sit at
 * getPointAtLength(progress) so position is exact. Colours come from the
 * biome tokens, so the chart re-tints when the theme changes. */
export function QuestMap({ journey, markers, className }: { journey: Journey; markers: MapMarker[]; className?: string }) {
  const refPath = useRef<SVGPathElement>(null)
  const [total, setTotal] = useState(0)
  useEffect(() => {
    if (refPath.current) setTotal(refPath.current.getTotalLength())
  }, [journey.map.path])

  const points = useMemo(() => {
    const path = refPath.current
    if (!path || !total) return null
    const at = (frac: number) => {
      const p = path.getPointAtLength(Math.max(0, Math.min(1, frac)) * total)
      return { x: p.x, y: p.y }
    }
    return {
      stages: journey.stages.map((s) => at(s.start_m / journey.total_m)),
      end: at(1),
      milestones: journey.events.filter((e) => e.kind === "milestone").map((m) => at(m.at_m / journey.total_m)),
      markers: markers.map((m) => ({ ...m, ...at(m.fraction) })),
    }
  }, [journey, markers, total])

  const best = Math.max(0, ...markers.filter((m) => m.me).map((m) => m.fraction), ...(markers.some((m) => m.me) ? [] : markers.map((m) => m.fraction)))

  return (
    <svg viewBox={journey.map.view_box} role="img" aria-label={`Map: ${journey.name}`} className={className ?? "h-auto w-full"}>
      <defs>
        <radialGradient id="mapbg" cx="50%" cy="40%" r="75%">
          <stop offset="0" stopColor="var(--th-bg-2)" />
          <stop offset="1" stopColor="var(--th-bg)" />
        </radialGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="white" strokeOpacity="0.035" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#mapbg)" />
      <rect width="100%" height="100%" fill="url(#grid)" />
      <path d={journey.map.path} fill="none" strokeWidth={5} strokeLinecap="round" strokeDasharray="0.5 11" stroke="white" strokeOpacity={0.35} />
      {total > 0 && (
        <path d={journey.map.path} fill="none" strokeWidth={5} strokeLinecap="round" stroke="var(--th-accent)" filter="url(#glow)" strokeDasharray={`${total} ${total}`} strokeDashoffset={total * (1 - best)} style={{ transition: "stroke-dashoffset 1s ease" }} />
      )}
      <path ref={refPath} d={journey.map.path} fill="none" />
      {journey.map.decor.map((d, i) => d.kind === "label" && (
        <text key={i} x={d.x} y={d.y} fontSize={20} textAnchor="middle" fill="white" fillOpacity={0.4} style={{ fontFamily: "var(--display-font)", fontWeight: 500 }}>{d.text}</text>
      ))}
      {points && (
        <>
          {points.milestones.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={3} fill="white" fillOpacity={0.4} />)}
          {points.stages.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={7} fill="var(--th-bg)" stroke="var(--th-accent)" strokeWidth={2} />)}
          <g transform={`translate(${points.end.x} ${points.end.y})`}>
            <circle r={10} fill="var(--th-bg)" stroke="white" strokeWidth={2.5} />
            <circle r={4} fill="white" />
          </g>
          {points.markers.map((m, i) => (
            <g key={i} transform={`translate(${m.x} ${m.y})`}>
              {m.me && <circle r={20} fill={m.color} fillOpacity={0.2} />}
              <circle r={m.me ? 11 : 8} fill={m.color} stroke="var(--th-bg)" strokeWidth={3} />
              {m.label && <text y={-20} fontSize={15} textAnchor="middle" fill="white" fontWeight={600} stroke="var(--th-bg)" strokeWidth={4} paintOrder="stroke">{m.label}</text>}
            </g>
          ))}
        </>
      )}
    </svg>
  )
}
