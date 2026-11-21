/** One restrained confetti burst for genuine rewards (canvas-confetti, lazy). */
const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

export async function confettiBurst(colors: string[], opts: { big?: boolean } = {}) {
  if (reduced()) return
  const { default: confetti } = await import("canvas-confetti")
  confetti({ colors, disableForReducedMotion: true, zIndex: 400, particleCount: opts.big ? 70 : 32, spread: 60, startVelocity: 34, ticks: 120, scalar: 0.8, origin: { y: 0.6 } })
}
