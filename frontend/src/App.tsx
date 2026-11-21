import { useEffect } from "react"
import { Toaster } from "sonner"
import { useStore } from "@/lib/store"
import { applyTheme, displayFont } from "@/lib/theme"
import { Auth } from "@/views/Auth"
import { Shell } from "@/shell/Shell"

function Splash() {
  return (
    <div id="boot-splash" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[var(--th-bg)]">
      <div className="text-4xl font-semibold tracking-tight">Walkhome</div>
      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-white/10"><div className="skeleton h-full w-full" /></div>
    </div>
  )
}

/** The active biome drives the whole palette; changing biome cross-fades. */
function useThemeSync() {
  const journeyId = useStore((s) => s.snap?.journey_id ?? s.me?.journey_id)
  const biome = useStore((s) => s.snap?.session?.biome ?? s.snap?.subject.biome ?? null)
  const loggedIn = useStore((s) => !!s.me)
  useEffect(() => {
    if (!loggedIn) return
    applyTheme(biome?.palette, journeyId)
    document.documentElement.dataset.font = displayFont(journeyId) === "cinzel" ? "cinzel" : ""
  }, [biome?.id, journeyId, loggedIn, biome?.palette])
}

export default function App() {
  const booted = useStore((s) => s.booted)
  const loggedIn = useStore((s) => !!s.me)
  const boot = useStore((s) => s.boot)
  useEffect(() => {
    boot()
  }, [boot])
  useThemeSync()
  useEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-[var(--th-accent)] focus:px-3 focus:py-2 focus:text-[var(--th-accent-fg)]">Skip to content</a>
      {!booted ? <Splash /> : loggedIn ? <Shell /> : <Auth />}
      <Toaster position="top-center" offset="calc(env(safe-area-inset-top) + 76px)" />
    </>
  )
}
