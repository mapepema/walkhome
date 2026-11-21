import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import type { CardDef, Rarity } from "../types"
import type { QualityProfile } from "../lib/quality"
import { rarityMeta } from "../rarity"
import { useCardTextures } from "../hooks/useCardTextures"
import { Halo, FloatingSparks } from "../scene/Aura"
import { CardMesh } from "../scene/CardMesh"
import { FitCamera } from "../scene/FitCamera"
import { PackMesh, PACK_H_U, PACK_W_U } from "../scene/PackMesh"
import type { PackArt } from "../scene/packCompositor"
import { PerfProbe } from "../scene/PerfProbe"
import { Stage } from "../scene/Stage"

export type OpeningPhase = "intro" | "ejecting" | "revealing" | "summary"

/* ---------- Burst particles (one draw call) + shockwave ---------- */
const BURST_COUNT: Record<Rarity, number> = { common: 0, uncommon: 14, rare: 40, holo: 90, ultra: 170, secret: 280 }

function Burst({ rarity, quality }: { rarity: Rarity; quality: QualityProfile }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const ring = useRef<THREE.ShaderMaterial>(null)
  const group = useRef<THREE.Group>(null)
  const color = rarityMeta(rarity).color
  const count = Math.round(BURST_COUNT[rarity] * (quality.tier === "low" ? 0.3 : quality.tier === "medium" ? 0.7 : 1))

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const dir = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const u = Math.random() * 2 - 1
      const s = Math.sqrt(1 - u * u)
      const sp = 1.2 + Math.random() * 2.6
      dir[i * 3] = Math.cos(a) * s * sp * 1.15
      dir[i * 3 + 1] = Math.sin(a) * s * sp * 1.15
      dir[i * 3 + 2] = u * sp * 0.6 + 0.4
      seed[i] = Math.random()
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute("aDir", new THREE.BufferAttribute(dir, 3))
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20)
    return g
  }, [count])
  const uniforms = useMemo(() => ({ uT: { value: 0 }, uColor: { value: new THREE.Color(color) }, uScale: { value: 400 }, uRainbow: { value: rarity === "secret" ? 1 : 0 } }), [color, rarity])
  const ringUniforms = useMemo(() => ({ uT: { value: 0 }, uColor: { value: new THREE.Color(color) } }), [color])

  useFrame((s, dt) => {
    const cam = s.camera as THREE.PerspectiveCamera
    uniforms.uScale.value = (s.size.height * s.viewport.dpr) / (2 * Math.tan((cam.fov * Math.PI) / 360))
    uniforms.uT.value += dt
    ringUniforms.uT.value += dt
    if (group.current) group.current.visible = uniforms.uT.value < 2
  })

  return (
    <group ref={group} position={[0, 0, 0.3]}>
      {count > 0 && (
        <points geometry={geo} frustumCulled={false}>
          <shaderMaterial
            ref={mat}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            uniforms={uniforms}
            vertexShader={`
              attribute vec3 aDir; attribute float aSeed; uniform float uT; uniform float uScale;
              varying float vA; varying float vSeed;
              void main(){
                float t = uT * (0.8 + aSeed*0.5);
                vec3 p = aDir * (1.0 - exp(-t*2.4)) ;
                p.y -= t*t*0.35;
                vec4 mv = modelViewMatrix * vec4(p,1.0);
                vA = clamp(1.0 - uT/1.7, 0.0, 1.0) * smoothstep(0.0,0.05,uT);
                vSeed = aSeed;
                gl_PointSize = (0.06 + aSeed*0.07) * uScale / -mv.z * (0.4 + vA);
                gl_Position = projectionMatrix * mv;
              }`}
            fragmentShader={`
              uniform vec3 uColor; uniform float uRainbow; varying float vA; varying float vSeed;
              vec3 hsv(float h){ return clamp(abs(mod(h*6.0+vec3(0.,4.,2.),6.0)-3.0)-1.0,0.0,1.0); }
              void main(){
                vec2 c = gl_PointCoord-0.5; float d = length(c);
                float a = smoothstep(0.5,0.0,d); a*=a;
                vec3 col = mix(uColor, hsv(vSeed), uRainbow*0.7);
                gl_FragColor = vec4(mix(col, vec3(1.0), a*0.6) * a * vA * 1.6, a*vA);
              }`}
          />
        </points>
      )}
      <mesh position={[0, 0, -0.05]} renderOrder={5}>
        <planeGeometry args={[9, 9]} />
        <shaderMaterial
          ref={ring}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          uniforms={ringUniforms}
          vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
          fragmentShader={`
            varying vec2 vUv; uniform float uT; uniform vec3 uColor;
            void main(){
              float d = length((vUv-0.5)*9.0);
              float r = 0.4 + uT*5.5;
              float w = 0.12 + uT*0.25;
              float ring = smoothstep(w,0.0,abs(d-r)) * clamp(1.0-uT/0.9,0.0,1.0);
              gl_FragColor = vec4(uColor*ring*1.4, ring);
            }`}
        />
      </mesh>
    </group>
  )
}

/* ---------- Pack wrapper ---------- */
function PackStage({ art, coverUrl, tear, exiting }: { art: Omit<PackArt, "cover">; coverUrl?: string; tear: number; exiting: boolean }) {
  const group = useRef<THREE.Group>(null)
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, [])
  useFrame((s, delta) => {
    const g = group.current
    if (!g) return
    const d = Math.min(delta, 0.05)
    const k = 1 - Math.exp(-3.4 * d)
    const t = s.clock.elapsedTime
    const bob = reduced || exiting ? 0 : Math.sin(t * 1.3) * 0.05
    const targetY = exiting ? -7 : bob
    const targetTilt = exiting ? 0.55 : 0.06 + (reduced ? 0 : Math.sin(t * 0.8) * 0.03)
    g.position.y += (targetY - g.position.y) * k
    g.rotation.x += (targetTilt - g.rotation.x) * k
    // small shake while pulling: the wrapper trembles with the gesture
    g.rotation.z = exiting ? 0 : Math.sin(t * 38) * 0.012 * Math.min(1, tear * 2)
    g.rotation.y = -0.12 + (reduced ? 0 : Math.sin(t * 0.6) * 0.08)
  })
  return (
    <group ref={group}>
      <PackMesh art={art} coverUrl={coverUrl} tear={tear} />
    </group>
  )
}

/* ---------- Reveal cards ---------- */
const INSIDE = new THREE.Vector3(0, -0.5, 0)
const DECK = new THREE.Vector3(0, -0.04, -1.2)
const STAGE = new THREE.Vector3(0, 0, 0)
const EXIT = new THREE.Vector3(0, -3.6, -0.5)

function RevealCard({ card, slot, ejecting, delay, faceUp, onFlip }: { card: CardDef; slot: number; ejecting: boolean; delay: number; faceUp: boolean; onFlip: () => void }) {
  const group = useRef<THREE.Group>(null)
  const tex = useCardTextures(card)
  const target = useMemo(() => new THREE.Vector3(), [])
  const elapsed = useRef(0)
  const flipAt = useRef(-10)
  const wasUp = useRef(false)

  useFrame((s, delta) => {
    const g = group.current
    if (!g) return
    const d = Math.min(delta, 0.05)
    elapsed.current += d
    if (ejecting && elapsed.current < delay) return
    const isFace = slot === 0 && faceUp
    if (isFace && !wasUp.current) flipAt.current = s.clock.elapsedTime
    wasUp.current = isFace
    const pop = Math.max(0, 1 - (s.clock.elapsedTime - flipAt.current) / 0.7)
    if (slot > 0) target.set(DECK.x, DECK.y - 0.02 * slot, DECK.z - 0.03 * slot)
    else if (slot === 0) target.set(STAGE.x, STAGE.y, STAGE.z + Math.sin(pop * Math.PI) * 0.7)
    else target.set(EXIT.x, EXIT.y - 0.15 * (-slot - 1), EXIT.z - 0.1 * (-slot - 1))
    const targetFlip = isFace ? 0 : Math.PI
    const targetScale = slot === 0 ? 1 : slot > 0 ? 0.9 : 0.85
    const targetRoll = slot < 0 ? -0.12 : 0
    const k = 1 - Math.exp(-6 * d)
    g.position.lerp(target, k)
    g.rotation.y += (targetFlip - g.rotation.y) * (isFace ? 1 - Math.exp(-9 * d) : k)
    g.rotation.z += (targetRoll - g.rotation.z) * k
    g.scale.setScalar(g.scale.x + (targetScale + pop * 0.1 - g.scale.x) * k)
  })

  return (
    <group
      ref={group}
      position={INSIDE}
      rotation={[0, Math.PI, 0]}
      scale={0.9}
      onClick={(e) => {
        if (slot !== 0 || faceUp) return
        e.stopPropagation()
        onFlip()
      }}
    >
      <CardMesh card={card} textures={tex} tiltStrength={slot === 0 && faceUp ? 1 : 0} pointer={slot === 0 && faceUp} idleSway={slot === 0 && faceUp} />
    </group>
  )
}

interface Props {
  phase: OpeningPhase
  art: Omit<PackArt, "cover">
  coverUrl?: string
  tear: number
  cards: CardDef[] | null
  index: number
  flipped: boolean
  burst: { key: number; rarity: Rarity } | null
  quality: QualityProfile
  onFlip: () => void
}

export function OpeningScene({ phase, art, coverUrl, tear, cards, index, flipped, burst, quality, onFlip }: Props) {
  const showPack = phase === "intro" || phase === "ejecting"
  const ejecting = phase === "ejecting" && !!cards
  const current = cards?.[index]
  const meta = current ? rarityMeta(current.rarity) : null
  const high = current && (current.rarity === "ultra" || current.rarity === "secret")
  const haloStrength = !current ? 0 : flipped ? { common: 0, uncommon: 0.25, rare: 0.55, holo: 0.85, ultra: 1.2, secret: 1.6 }[current.rarity] : { common: 0, uncommon: 0, rare: 0.18, holo: 0.3, ultra: 0.5, secret: 0.7 }[current.rarity]

  // Release the context cleanly on close.
  const glRef = useRef<THREE.WebGLRenderer | null>(null)
  useEffect(() => () => glRef.current?.dispose(), [])

  return (
    <Canvas
      camera={{ position: [0, 0, 6.2], fov: 32 }}
      flat
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={quality.dpr}
      style={{ touchAction: "none" }}
      onCreated={({ gl }) => (glRef.current = gl)}
    >
      {showPack ? <FitCamera width={PACK_W_U} height={PACK_H_U} marginX={1.2} marginY={1.3} /> : <FitCamera marginY={1.5} marginX={1.2} />}
      <Stage>
        {showPack && <PackStage art={art} coverUrl={coverUrl} tear={tear} exiting={ejecting} />}
        {cards?.map((card, i) => (
          <RevealCard key={`${card.id}-${i}`} card={card} slot={i - index} ejecting={ejecting} delay={0.2 + i * 0.12} faceUp={flipped} onFlip={onFlip} />
        ))}
        {phase === "revealing" && meta && haloStrength > 0 && <Halo color={meta.color} strength={haloStrength} />}
        {phase === "revealing" && flipped && high && quality.particles > 0 && <FloatingSparks color={meta!.color} count={Math.min(quality.particles, current!.rarity === "secret" ? 70 : 36)} />}
        {burst && phase === "revealing" && <Burst key={burst.key} rarity={burst.rarity} quality={quality} />}
      </Stage>
      <PerfProbe />
    </Canvas>
  )
}
