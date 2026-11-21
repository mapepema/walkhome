import { useEffect, useMemo, useState } from "react"
import * as THREE from "three"
import { compositePackBack, compositePackFront, TEAR_BAND, type PackArt } from "./packCompositor"
import { TEAR_OVERLAP, WrapperMaterial } from "./WrapperMaterial"

export const PACK_W_U = 2.35
export const PACK_H_U = 3.35
export const PACK_D_U = 0.13
const SEAM = 1 - TEAR_BAND

function packFace(vMin: number, vMax: number, segX: number, segY: number) {
  const geo = new THREE.PlaneGeometry(PACK_W_U, (vMax - vMin) * PACK_H_U, segX, segY)
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setY(i, vMin + uv.getY(i) * (vMax - vMin))
  uv.needsUpdate = true
  geo.translate(0, ((vMin + vMax) / 2 - 0.5) * PACK_H_U, 0)
  return geo
}
function packCore(vMin: number, vMax: number) {
  const geo = new THREE.BoxGeometry(PACK_W_U - 0.006, (vMax - vMin) * PACK_H_U - 0.006, PACK_D_U)
  geo.translate(0, ((vMin + vMax) / 2 - 0.5) * PACK_H_U, 0)
  return geo
}

function useCover(url?: string) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) return
    let alive = true
    const i = new Image()
    i.crossOrigin = "anonymous"
    i.onload = () => alive && setImg(i)
    i.src = url
    return () => {
      alive = false
    }
  }, [url])
  return url ? img : null
}

interface Props {
  art: Omit<PackArt, "cover">
  coverUrl?: string
  tear?: number
}

/** 3D pack wrapper: two pieces sharing the same image; the top strip curls with the gesture. */
export function PackMesh({ art, coverUrl, tear = 0 }: Props) {
  const cover = useCover(coverUrl)
  const [front, back] = useMemo(() => {
    const make = (canvas: HTMLCanvasElement) => {
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 8
      return tex
    }
    const full = { ...art, cover }
    return [make(compositePackFront(full)), make(compositePackBack(full))]
  }, [art, cover])

  const geo = useMemo(
    () => ({
      bodyFront: packFace(0, SEAM + TEAR_OVERLAP, 1, 1),
      bodyBack: packFace(0, SEAM + TEAR_OVERLAP, 1, 1),
      bodyCore: packCore(0, SEAM),
      stripFront: packFace(SEAM - TEAR_OVERLAP, 1, 72, 3),
      stripBack: packFace(SEAM - TEAR_OVERLAP, 1, 72, 3),
      stripCore: packCore(SEAM, 1),
    }),
    [],
  )
  const mats = useMemo(
    () => ({
      bodyFront: new WrapperMaterial("body"),
      bodyBack: new WrapperMaterial("body"),
      stripFront: new WrapperMaterial("strip"),
      stripBack: new WrapperMaterial("strip"),
      bodyCore: new THREE.MeshPhysicalMaterial({ color: "#0b0f1a", roughness: 0.5, metalness: 0.35 }),
      stripCore: new WrapperMaterial("core", { color: "#0b0f1a", roughness: 0.5, metalness: 0.35 }),
    }),
    [],
  )

  useEffect(() => {
    mats.bodyFront.map = front
    mats.stripFront.map = front
    mats.bodyBack.map = back
    mats.stripBack.map = back
    for (const m of [mats.bodyFront, mats.bodyBack, mats.stripFront, mats.stripBack]) m.needsUpdate = true
    return () => {
      front.dispose()
      back.dispose()
    }
  }, [mats, front, back])

  useEffect(() => {
    for (const m of [mats.bodyFront, mats.bodyBack, mats.stripFront, mats.stripBack, mats.stripCore]) m.uniforms.uTear.value = tear
  }, [mats, tear])

  const z = PACK_D_U / 2 + 0.001
  return (
    <group>
      <mesh geometry={geo.bodyCore} material={mats.bodyCore} />
      <mesh geometry={geo.bodyFront} material={mats.bodyFront} position={[0, 0, z]} />
      <mesh geometry={geo.bodyBack} material={mats.bodyBack} position={[0, 0, -z]} rotation={[0, Math.PI, 0]} />
      <group>
        <mesh geometry={geo.stripCore} material={mats.stripCore} />
        <mesh geometry={geo.stripFront} material={mats.stripFront} position={[0, 0, z]} />
        <mesh geometry={geo.stripBack} material={mats.stripBack} position={[0, 0, -z]} rotation={[0, Math.PI, 0]} />
      </group>
    </group>
  )
}
