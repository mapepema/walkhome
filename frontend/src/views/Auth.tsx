import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowRight, Footprints, Layers, Loader2, Trophy } from "lucide-react"
import { useT } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { ApiError, errMsg } from "@/lib/api"
import { applyTheme } from "@/lib/theme"
import { haptic } from "@/lib/haptics"
import { Field } from "@/kit/Field"
import { AvatarPicker, ThemePicker } from "@/kit/pickers"
import { Avatar, Segmented, Skeleton } from "@/kit/ui"
import type { ThemeInfo } from "@/lib/types"

const FEATURES = [
  { icon: Footprints, t: "Walk", d: "Every kilometre moves your quest forward" },
  { icon: Layers, t: "Collect", d: "Holo card packs to earn" },
  { icon: Trophy, t: "Overtake", d: "Challenge your household in the race" },
]

export function Auth() {
  const t = useT()
  const themes = useStore((s) => s.themes)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [theme, setTheme] = useState<ThemeInfo | null>(null)
  const [avatar, setAvatar] = useState("mountain")
  const [color, setColor] = useState("#e3b45c")
  const [invite, setInvite] = useState("")
  const [needInvite, setNeedInvite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = theme ?? themes[0] ?? null
  // the whole page takes on the chosen theme's colours
  useEffect(() => {
    applyTheme(active?.palette, active?.id, active?.accent)
    document.documentElement.dataset.font = active?.id === "camino" ? "cinzel" : ""
  }, [active])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (mode === "register" && password.length < 8) return setError("The password must be at least 8 characters long.")
    setBusy(true)
    try {
      if (mode === "login") await login(username.trim(), password)
      else
        await register({ username: username.trim(), password, journey_id: active?.id, avatar, color, ...(needInvite ? { invite_code: invite } : {}) })
      haptic.success()
    } catch (err) {
      haptic.warn()
      if (err instanceof ApiError && err.code === "invite_required") setNeedInvite(true)
      setError(err instanceof ApiError && err.status === 429 ? "Too many attempts: wait a minute." : errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      {/* ---- hero ---- */}
      <section className="relative isolate flex min-h-[260px] flex-col justify-end overflow-hidden lg:min-h-dvh lg:justify-between lg:p-14">
        <div
          className="absolute inset-0 -z-10 transition-[background] duration-700"
          style={{ background: active?.palette ? `radial-gradient(90% 70% at 20% 10%, ${active.palette.sky[0]}66, transparent 70%), radial-gradient(80% 60% at 90% 90%, ${active.palette.far}55, transparent 70%), var(--th-bg)` : "var(--th-bg)" }}
        />
        <div className="hidden text-sm font-medium text-white/60 lg:block">{t.appTagline}</div>
        <div className="px-6 pb-8 pt-16 lg:p-0">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <h1 className="text-[44px] font-semibold leading-none tracking-tight text-white lg:text-[80px]">Walkhome</h1>
            <p className="mt-3 max-w-md text-[17px] leading-relaxed text-white/70 lg:mt-5 lg:text-xl">
              {active ? <>Cross {active.name}, step by step, from your treadmill.</> : "Turn every step into an adventure."}
            </p>
          </motion.div>
          <ul className="mt-10 hidden gap-3 lg:flex">
            {FEATURES.map(({ icon: I, t: title, d }) => (
              <li key={title} className="glass-dark max-w-[220px] flex-1 rounded-2xl p-4">
                <I className="size-5 text-white/80" strokeWidth={1.8} />
                <div className="mt-3 text-sm font-semibold text-white">{title}</div>
                <div className="mt-0.5 text-xs leading-snug text-white/60">{d}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---- form ---- */}
      <section className="relative z-10 -mt-6 flex items-start justify-center rounded-t-[1.75rem] bg-[var(--th-bg)] px-5 pb-10 pt-7 lg:mt-0 lg:items-center lg:rounded-none lg:p-12">
        <div className="w-full max-w-md">
          <Segmented className="mb-6 w-full [&>button]:flex-1" value={mode} onChange={(m) => { setMode(m); setError(null) }} options={[{ value: "login", label: t.login }, { value: "register", label: t.register }]} />
          <form onSubmit={submit} className="flex flex-col gap-4">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={mode} initial={{ opacity: 0, x: mode === "login" ? -16 : 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
                <Field label={t.username} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_.\-]+" placeholder="your_name" hint={mode === "register" ? "3 to 24 characters: letters, digits, _ . -" : undefined} />
                <Field label={t.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} placeholder="••••••••" hint={mode === "register" ? "At least 8 characters" : undefined} />
                {mode === "register" && (
                  <>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">{t.chooseQuest}</div>
                      {themes.length ? <ThemePicker themes={themes} value={active?.id ?? ""} onChange={setTheme} /> : <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>}
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-muted-foreground">
                        <span>{t.yourAvatar}</span>
                        <Avatar emoji={avatar} color={color} size={34} ring />
                      </div>
                      <AvatarPicker avatar={avatar} color={color} onAvatar={setAvatar} onColor={setColor} />
                    </div>
                    {needInvite && <Field label="Invite code" value={invite} onChange={(e) => setInvite(e.target.value)} required />}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            {error && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-3.5 py-2.5 text-sm text-red-200">{error}</div>}
            <button type="submit" disabled={busy || (mode === "register" && !active)} className="btn-gold mt-1 flex h-14 items-center justify-center gap-2 rounded-full text-base">
              {busy ? <Loader2 className="size-5 animate-spin" /> : <>{mode === "login" ? t.resumeRoad : t.startAdventure} <ArrowRight className="size-5" /></>}
            </button>
            {mode === "register" && <p className="text-center text-xs text-muted-foreground">{t.welcomePacks}</p>}
          </form>
        </div>
      </section>
    </div>
  )
}
