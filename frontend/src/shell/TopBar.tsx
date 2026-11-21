import { Bell } from "lucide-react"
import { href } from "@/lib/router"
import { useStore } from "@/lib/store"
import { useUi } from "@/lib/ui"
import { cn } from "@/lib/utils"
import { Avatar } from "@/kit/ui"

/** Phone header: biome title, live link dot, bell, avatar. */
export function TopBar() {
  const journey = useStore((s) => s.journey)
  const me = useStore((s) => s.me)
  const unread = useStore((s) => s.unread)
  const wsOpen = useStore((s) => s.wsOpen)
  const link = useStore((s) => s.snap?.link.state)
  const setNotif = useUi((s) => s.setNotif)
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,var(--safe-top))] lg:hidden">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[var(--th-bg)] via-[var(--th-bg)]/85 to-transparent" />
      <span
        title={link === "live" ? "Treadmill connected" : "Treadmill not connected"}
        className={cn("size-2 shrink-0 rounded-full", wsOpen && link === "live" ? "bg-emerald-400" : wsOpen ? "bg-amber-400" : "bg-red-400")}
      />
      <div className="min-w-0 flex-1">
        <div className="eyebrow">Walkhome</div>
        <div className="font-display truncate text-[17px] leading-tight">{journey?.name}</div>
      </div>
      <button onClick={() => setNotif(true)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="glass-dark relative flex size-10 items-center justify-center rounded-full">
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[var(--th-accent)] px-1 text-center text-[10px] font-bold leading-[18px] text-[var(--th-accent-fg)] ring-2 ring-[var(--th-bg)]">
            {unread}
          </span>
        )}
      </button>
      {me && (
        <a href={href("profile")} aria-label="Profile">
          <Avatar emoji={me.avatar} color={me.color} size={40} ring />
        </a>
      )}
    </header>
  )
}
