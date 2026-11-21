/** Haptics + a tiny feature-detected vibration vocabulary. */
const can = typeof navigator !== "undefined" && "vibrate" in navigator

function v(p: number | number[]) {
  if (!can) return
  try {
    navigator.vibrate(p)
  } catch {
    /* ignore */
  }
}

export const haptic = {
  tap: () => v(8),
  select: () => v(14),
  success: () => v([18, 40, 28]),
  reward: () => v([30, 50, 30, 50, 90]),
  warn: () => v([60, 40, 60]),
}
