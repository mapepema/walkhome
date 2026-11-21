import { Canvas } from "@react-three/fiber"
import { useMemo } from "react"
import type { CardDef } from "../types"
import { useCardTextures } from "../hooks/useCardTextures"
import { detectQuality } from "../lib/quality"
import { rarityMeta } from "../rarity"
import { Halo, FloatingSparks } from "./Aura"
import { CardMesh } from "./CardMesh"
import { FitCamera } from "./FitCamera"
import { PerfProbe } from "./PerfProbe"
import { Stage } from "./Stage"
import { resolveTreatment } from "./treatments"

function Content({ card, tiltStrength }: { card: CardDef; tiltStrength: number }) {
  const q = useMemo(() => detectQuality(), [])
  const tex = useCardTextures(card)
  const t = useMemo(() => resolveTreatment(card), [card])
  const color = rarityMeta(card.rarity).color
  return (
    <>
      <FitCamera marginY={1.42} marginX={1.14} />
      <Stage>
        {t.aura > 0 && <Halo color={color} strength={0.25 + t.aura * 0.55} />}
        <FloatingSparks color={color} count={Math.min(t.particles, q.particles)} />
        <CardMesh card={card} textures={tex} tiltStrength={tiltStrength} />
      </Stage>
      <PerfProbe />
    </>
  )
}

/** Full-frame WebGL canvas for one card: ONE context, used only for the detail view. */
export function CardScene({ card, tiltStrength = 1, className }: { card: CardDef; tiltStrength?: number; className?: string }) {
  const q = useMemo(() => detectQuality(), [])
  return (
    <Canvas
      className={className}
      camera={{ position: [0, 0, 6], fov: 32 }}
      dpr={q.dpr}
      flat
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <Content card={card} tiltStrength={tiltStrength} />
    </Canvas>
  )
}
