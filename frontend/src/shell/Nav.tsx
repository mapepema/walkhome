import { motion } from "framer-motion"
import { Bell, Ellipsis } from "lucide-react"
import { cn } from "@/lib/utils"
import { href, useRoute, type Tab } from "@/lib/router"
import { selSession, useStore } from "@/lib/store"
import { useUi } from "@/lib/ui"
import { haptic } from "@/lib/haptics"
import { Avatar } from "@/kit/ui"
import { Sheet } from "@/kit/Sheet"
import { useT } from "@/lib/i18n"
import { BAR_TABS, MORE_TABS, NAV, nav } from "./navItems"

function useBadges(): Partial<Record<Tab, number | "dot">> {
  const packs = useStore((s) => s.snap?.packs.unopened ?? 0)
  const claimable = useStore((s) => s.snap?.me.unopened_packs ?? 0)
  const walking = useStore((s) => !!selSession(s))
  return { packs: packs || claimable || undefined, walk: walking ? "dot" : undefined }
}

function Badge({ v }: { v: number | "dot" }) {
  return v === "dot" ? (
    <span className="absolute right-1 top-0 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[var(--th-bg)]" />
  ) : (
    <span className="absolute -right-1.5 -top-1 min-w-[18px] rounded-full bg-[var(--th-accent)] px-1 text-center text-[10px] font-bold leading-[18px] text-[var(--th-accent-fg)] ring-2 ring-[var(--th-bg)]">
      {v}
    </span>
  )
}

/** ---- phone: bottom tab bar with a raised "Walk" action ---- */
export function BottomBar() {
  const tr = useT()
  const { tab: current } = useRoute()
  const badges = useBadges()
  const { moreOpen, setMore } = useUi()
  const moreActive = MORE_TABS.includes(current)
  return (
    <>
      <nav
        aria-label="Main navigation"
        className="glass-dark fixed inset-x-3 bottom-[max(0.75rem,var(--safe-bottom))] z-40 flex items-end rounded-[1.75rem] px-1.5 pb-1.5 pt-1.5 shadow-2xl shadow-black/60 lg:hidden"
      >
        {BAR_TABS.map((t) => {
          const it = nav(t)
          const Icon = it.icon
          const active = current === t
          if (t === "walk")
            return (
              <a
                key={t}
                href={href(t)}
                onClick={() => haptic.tap()}
                aria-label="Walk"
                aria-current={active ? "page" : undefined}
                className="relative -mt-6 flex flex-1 flex-col items-center"
              >
                <span className="btn-gold flex size-[60px] items-center justify-center rounded-full ring-4 ring-[var(--th-bg)]">
                  <Icon className="size-7" strokeWidth={2.2} />
                </span>
                {badges.walk && <Badge v={badges.walk} />}
                <span className={cn("mt-0.5 text-[10px] font-semibold", active ? "text-gold" : "text-muted-foreground")}>{tr.nav.walk}</span>
              </a>
            )
          return (
            <a
              key={t}
              href={href(t)}
              onClick={() => haptic.tap()}
              aria-current={active ? "page" : undefined}
              className={cn("relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold transition-colors", active ? "text-gold" : "text-muted-foreground")}
            >
              <span className="relative">
                <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.8} />
                {badges[t] && <Badge v={badges[t]!} />}
              </span>
              {tr.nav[t]}
              {active && <motion.span layoutId="bar-dot" className="absolute -bottom-0.5 h-0.5 w-5 rounded-full bg-[var(--th-accent)]" />}
            </a>
          )
        })}
        <button
          onClick={() => setMore(true)}
          aria-label={tr.nav.more}
          className={cn("relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-semibold", moreActive ? "text-gold" : "text-muted-foreground")}
        >
          <Ellipsis className="size-[22px]" />
          {tr.nav.more}
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMore(false)} />
    </>
  )
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tab: current } = useRoute()
  return (
    <Sheet open={open} onClose={onClose} title="Explore" variant="modal">
      <div className="grid grid-cols-2 gap-3 pb-2 pt-1">
        {MORE_TABS.map((t) => {
          const it = nav(t)
          const Icon = it.icon
          return (
            <a
              key={t}
              href={href(t)}
              onClick={onClose}
              className={cn("glass flex items-center gap-3 p-4 text-sm font-semibold", current === t && "glass-hi text-gold")}
            >
              <Icon className="size-5 text-gold" />
              {it.label}
            </a>
          )
        })}
      </div>
    </Sheet>
  )
}

/** ---- desktop: full left rail ---- */
export function Sidebar() {
  const tr = useT()
  const { tab: current } = useRoute()
  const badges = useBadges()
  const journey = useStore((s) => s.journey)
  const me = useStore((s) => s.me)
  const unread = useStore((s) => s.unread)
  const wsOpen = useStore((s) => s.wsOpen)
  const setNotif = useUi((s) => s.setNotif)
  const rank = useStore((s) => s.snap?.rank.week)
  return (
    <aside className="glass-dark fixed inset-y-3 left-3 z-40 hidden w-[256px] flex-col rounded-3xl p-4 lg:flex">
      <a href={href("camp")} className="px-2 pb-4 pt-2">
        <div className="eyebrow">Walkhome</div>
        <div className="font-display mt-1 text-[19px] leading-tight">{journey?.name ?? "—"}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{journey?.subtitle}</div>
      </a>
      <div className="mb-3 h-px bg-white/8" />
      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1">
        {NAV.map((it) => {
          const Icon = it.icon
          const active = current === it.tab
          const b = badges[it.tab]
          return (
            <a
              key={it.tab}
              href={href(it.tab)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                active ? "text-gold" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                it.tab === "walk" && !active && "text-foreground",
              )}
            >
              {active && (
                <motion.span layoutId="rail-active" className="absolute inset-0 rounded-xl border border-[var(--line-hi)] bg-[color-mix(in_oklab,var(--th-accent)_10%,transparent)]" />
              )}
              <Icon className="relative size-[19px]" strokeWidth={active ? 2.3 : 1.8} />
              <span className="relative flex-1">{tr.nav[it.tab]}</span>
              {typeof b === "number" && <span className="relative rounded-full bg-[var(--th-accent)] px-1.5 text-[11px] font-bold text-[var(--th-accent-fg)]">{b}</span>}
              {b === "dot" && <span className="relative size-2 rounded-full bg-emerald-400" />}
              {it.tab === "race" && rank ? <span className="tnum relative text-xs text-muted-foreground">#{rank}</span> : null}
            </a>
          )
        })}
      </nav>
      {me && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/5 p-2.5">
          <Avatar emoji={me.avatar} color={me.color} size={38} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{me.display_name}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", wsOpen ? "bg-emerald-400" : "bg-amber-400")} />
              {wsOpen ? "Live" : "Reconnecting…"}
            </div>
          </div>
          <button onClick={() => setNotif(true)} aria-label="Notifications" className="relative flex size-9 items-center justify-center rounded-full hover:bg-white/10">
            <Bell className="size-[18px]" />
            {unread > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-[var(--th-accent)] px-1 text-center text-[10px] font-bold leading-4 text-[var(--th-accent-fg)]">{unread}</span>}
          </button>
        </div>
      )}
    </aside>
  )
}

export { NAV }
