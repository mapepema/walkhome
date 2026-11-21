import { useEffect, useRef, useState } from "react"
import { Pause, WifiOff } from "lucide-react"
import { selSession, useStore } from "@/lib/store"
import { SpeedDial, StatGrid } from "./walk/Hud"
import { ChallengePanel } from "./walk/ChallengePanel"
import { PackProgress } from "./walk/PackProgress"
import { Controls } from "./walk/Controls"
import { RoadAhead } from "./walk/RoadAhead"
import { Idle, type Summary } from "./walk/Idle"

function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | null = null
    const req = async () => { try { lock = await navigator.wakeLock.request("screen") } catch { /* denied */ } }
    req()
    const onVis = () => document.visibilityState === "visible" && req()
    document.addEventListener("visibilitychange", onVis)
    return () => { document.removeEventListener("visibilitychange", onVis); lock?.release().catch(() => {}) }
  }, [active])
}

/** Walk: a calm instrument panel. Biome palette tints the background. */
export function Walk() {
  const session = useStore(selSession)
  const journey = useStore((s) => s.journey)
  const [summary, setSummary] = useState<Summary | null>(null)
  const last = useRef<{ s: NonNullable<typeof session>; packs: number } | null>(null)
  const packsAtStart = useRef<number | null>(null)
  const unopened = useStore((s) => s.snap?.packs.unopened ?? 0)

  useWakeLock(!!session)
  if (session) {
    last.current = { s: session, packs: unopened }
    if (packsAtStart.current === null) packsAtStart.current = unopened
  }

  const onStopped = () => {
    const l = last.current
    if (l) {
      const t = l.s.telemetry
      setSummary({ distance_m: t.distance_m, moving_s: t.moving_s, elapsed_s: t.elapsed_s, maxKmh: t.max_speed_kmh, packsGained: Math.max(0, l.packs - (packsAtStart.current ?? l.packs)) })
    }
    packsAtStart.current = null
    last.current = null
  }

  if (!session || !journey) return <Idle summary={summary} onClear={() => setSummary(null)} />

  const p = session.biome?.palette
  const bg = p ? `linear-gradient(180deg, color-mix(in oklab, ${p.sky[0]} 30%, #0b0b0c), #0b0b0c 70%)` : undefined
  return (
    <div className="min-h-dvh px-4 pb-8 pt-[max(1rem,var(--safe-top))] lg:px-10 lg:pt-8" style={{ background: bg }}>
      <div className="mx-auto grid max-w-[1180px] gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <header>
            <div className="text-[13px] font-medium text-white/60">{session.stage?.name}</div>
            <h1 className="font-display mt-1 text-[28px] leading-tight text-white lg:text-[36px]">{session.biome?.name}</h1>
          </header>
          <div className="relative py-2">
            <SpeedDial session={session} />
            {(session.state === "no_link" || session.state === "paused") && (
              <div className="mt-5 flex justify-center">
                <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white">
                  {session.state === "no_link" ? <><WifiOff className="size-4 text-amber-400" /> Treadmill connection lost, reconnecting…</> : <><Pause className="size-4" /> {session.manual_pause ? "Paused" : "Auto-paused, treadmill stopped"}</>}
                </div>
              </div>
            )}
          </div>
          <StatGrid session={session} />
          <RoadAhead />
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-8 lg:self-start">
          {session.challenge && <ChallengePanel c={session.challenge} />}
          <PackProgress progressM={session.progress_m} />
          <Controls session={session} onStopped={onStopped} />
        </aside>
      </div>
    </div>
  )
}
