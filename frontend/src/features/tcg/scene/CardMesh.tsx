import { useEffect, useMemo, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import type { CardDef } from "../types"
import type { CardTextures } from "./cardTextures"
import { CARD_FACE_Z, createCardBands, createCardFace } from "./cardGeometry"
import { cardBackTexture } from "./cardBack"
import { HoloCardMaterial } from "./HoloCardMaterial"
import { resolveTreatment } from "./treatments"
import { deviceTilt } from "../lib/tilt"
import { prefersReducedMotion } from "../lib/quality"

interface Props {
  card: CardDef
  textures: CardTextures | null
  /** 0 = still card, 1 = full tilt. */
  tiltStrength?: number
  /** Follows the canvas pointer (mouse hover / touch drag). */
  pointer?: boolean
  /** Idle sway (the foil stays alive without interaction). */
  idleSway?: boolean
}

/**
 * 3D card: paper/core/paper laminate + holo face + back.
 * Tilt comes from the gyroscope when active, otherwise from the pointer on the canvas.
 */
export function CardMesh({ card, textures: tex, tiltStrength = 1, pointer = true, idleSway = true }: Props) {
  const group = useRef<THREE.Group>(null)
  const gl = useThree((s) => s.gl)
  const bands = useMemo(() => createCardBands(), [])
  const faceGeo = useMemo(() => createCardFace(), [])
  const frontMat = useMemo(() => new HoloCardMaterial(), [])
  const backMat = useMemo(() => new THREE.MeshPhysicalMaterial({ map: cardBackTexture(), roughness: 0.55, clearcoat: 0.4 }), [])
  const paperMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#f1efe8", roughness: 0.88 }), [])
  const coreMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: "#16171b", roughness: 0.8 }), [])
  const treatment = useMemo(() => resolveTreatment(card), [card])
  const reduced = useMemo(prefersReducedMotion, [])

  useEffect(() => {
    frontMat.setTreatment(treatment)
  }, [frontMat, treatment])

  useEffect(() => {
    if (tex) frontMat.setTextures(tex.map, tex.mask, tex.normal)
  }, [frontMat, tex])

  useEffect(
    () => () => {
      frontMat.dispose()
      backMat.dispose()
      paperMat.dispose()
      coreMat.dispose()
      bands.front.dispose()
      bands.core.dispose()
      bands.back.dispose()
      faceGeo.dispose()
    },
    [frontMat, backMat, paperMat, coreMat, bands, faceGeo],
  )

  // Pointer: listeners on the canvas only (no leaks between components).
  const input = useRef({ x: 0, y: 0, down: false, active: false, lastMove: -10 })
  useEffect(() => {
    if (!pointer) return
    const el = gl.domElement
    const set = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      input.current.x = ((e.clientX - r.left) / r.width) * 2 - 1
      input.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1)
      input.current.lastMove = performance.now() / 1000
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || input.current.down) {
        set(e)
        input.current.active = true
      }
    }
    const down = (e: PointerEvent) => {
      input.current.down = true
      set(e)
      input.current.active = true
    }
    const up = (e: PointerEvent) => {
      input.current.down = false
      if (e.pointerType !== "mouse") input.current.active = false
    }
    const leave = () => {
      input.current.active = false
      input.current.down = false
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerdown", down)
    window.addEventListener("pointerup", up)
    el.addEventListener("pointerleave", leave)
    return () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerdown", down)
      window.removeEventListener("pointerup", up)
      el.removeEventListener("pointerleave", leave)
    }
  }, [gl, pointer])

  const prevQuat = useRef(new THREE.Quaternion())

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const d = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    frontMat.uniforms.uTime.value = t

    let inX = 0
    let inY = 0
    if (deviceTilt.active) {
      inX = deviceTilt.x
      inY = deviceTilt.y
    } else if (input.current.active) {
      inX = input.current.x
      inY = input.current.y
    } else if (idleSway && !reduced) {
      // Breathing: slow Lissajous, wide enough for the foil to move at rest.
      inX = Math.sin(t * 0.7) * 0.42 + Math.sin(t * 0.31) * 0.15
      inY = Math.cos(t * 0.53) * 0.3
    }
    const targetX = -inY * 0.4 * tiltStrength
    const targetY = inX * 0.55 * tiltStrength
    const k = 1 - Math.exp(-9 * d)
    g.rotation.x += (targetX - g.rotation.x) * k
    g.rotation.y += (targetY - g.rotation.y) * k

    const dot = Math.min(1, Math.abs(prevQuat.current.dot(g.quaternion)))
    const angVel = (2 * Math.acos(dot)) / Math.max(d, 1e-4)
    prevQuat.current.copy(g.quaternion)
    const u = frontMat.uniforms.uMotion
    u.value += (THREE.MathUtils.clamp(angVel * 0.4, 0, 1) - u.value) * (1 - Math.exp(-6 * d))
  })

  return (
    <group ref={group}>
      <mesh geometry={bands.front} material={paperMat} />
      <mesh geometry={bands.core} material={coreMat} />
      <mesh geometry={bands.back} material={paperMat} />
      <mesh geometry={faceGeo} material={frontMat} position={[0, 0, CARD_FACE_Z]} />
      <mesh geometry={faceGeo} material={backMat} position={[0, 0, -CARD_FACE_Z]} rotation={[0, Math.PI, 0]} />
    </group>
  )
}
