import { useEffect } from "react"
import { useThree } from "@react-three/fiber"
import type { PerspectiveCamera } from "three"
import { CARD_H, CARD_W } from "./cardGeometry"

/** Pulls the camera back so the subject always fits in frame (portrait or landscape). */
export function FitCamera({
  marginY = 1.3,
  marginX = 1.08,
  width = CARD_W,
  height = CARD_H,
}: {
  marginY?: number
  marginX?: number
  width?: number
  height?: number
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  useEffect(() => {
    const cam = camera as PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const aspect = size.width / size.height
    const halfFov = (cam.fov * Math.PI) / 360
    const byHeight = (height * marginY) / 2 / Math.tan(halfFov)
    const byWidth = (width * marginX) / 2 / Math.tan(halfFov) / aspect
    cam.position.z = Math.max(byHeight, byWidth)
    cam.updateProjectionMatrix()
  }, [camera, size, marginX, marginY, width, height])
  return null
}
