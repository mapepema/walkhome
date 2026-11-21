/**
 * Gyroscope tilt source (mobile). The pointer is handled by CardMesh
 * (listeners on the canvas): this only covers device orientation.
 */
export interface DeviceTilt {
  x: number
  y: number
  active: boolean
}
export const deviceTilt: DeviceTilt = { x: 0, y: 0, active: false }

type PermissionAPI = { requestPermission?: () => Promise<"granted" | "denied"> }

export function supportsDeviceTilt(): boolean {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window
}

export function needsMotionPermission(): boolean {
  const api = (window as unknown as { DeviceOrientationEvent?: PermissionAPI }).DeviceOrientationEvent
  return typeof api?.requestPermission === "function"
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const REST_BETA = 40

function onOrientation(e: DeviceOrientationEvent) {
  if (e.gamma === null || e.beta === null) return
  const landscape = Math.abs(window.screen?.orientation?.angle ?? 0) === 90
  const g = landscape ? e.beta - REST_BETA : e.gamma
  const b = landscape ? -e.gamma : e.beta - REST_BETA
  deviceTilt.x = clamp(g / 35, -1, 1)
  deviceTilt.y = clamp(-b / 35, -1, 1)
  deviceTilt.active = true
}

let listening = false

/** Call from a user gesture (iOS 13+ requires explicit permission). */
export async function enableDeviceTilt(): Promise<boolean> {
  if (!supportsDeviceTilt()) return false
  if (needsMotionPermission()) {
    const api = (window as unknown as { DeviceOrientationEvent: PermissionAPI }).DeviceOrientationEvent
    try {
      if ((await api.requestPermission!()) !== "granted") return false
    } catch {
      return false
    }
  }
  if (!listening) {
    window.addEventListener("deviceorientation", onOrientation, true)
    listening = true
  }
  return true
}

export function disableDeviceTilt() {
  window.removeEventListener("deviceorientation", onOrientation, true)
  listening = false
  deviceTilt.active = false
  deviceTilt.x = 0
  deviceTilt.y = 0
}
