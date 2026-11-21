import { useEffect } from "react"
import { motion } from "framer-motion"
import { BellOff, CheckCheck } from "lucide-react"
import { useStore } from "@/lib/store"
import { useUi } from "@/lib/ui"
import { fmtAgo } from "@/lib/format"
import { navigate } from "@/lib/router"
import { NotifGlyph } from "@/kit/icons"
import { Sheet } from "@/kit/Sheet"
import { EmptyState, Skeleton } from "@/kit/ui"
import { cn } from "@/lib/utils"
import type { AppNotification } from "@/lib/types"

function target(n: AppNotification) {
  const url = n.data?.url
  if (typeof url === "string" && url.startsWith("#")) location.hash = url
  else if (n.kind === "pack") navigate("packs")
  else if (n.kind === "rank_overtake" || n.kind === "weekly_podium") navigate("race")
  else if (n.kind === "quest") navigate("quests")
  else if (n.kind === "milestone") navigate("map")
}

export function NotificationCenter() {
  const { notifOpen, setNotif } = useUi()
  const list = useStore((s) => s.notifications)
  const unread = useStore((s) => s.unread)
  const load = useStore((s) => s.loadNotifications)
  const markRead = useStore((s) => s.markRead)

  useEffect(() => {
    if (notifOpen) load().catch(() => {})
  }, [notifOpen, load])

  return (
    <Sheet open={notifOpen} onClose={() => setNotif(false)} title="Notifications" description={unread ? `${unread} unread` : "All caught up"}>
      <div className="pb-4">
        {unread > 0 && (
          <button onClick={() => markRead()} className="btn-ghost-gold mb-3 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold">
            <CheckCheck className="size-3.5" /> Mark all as read
          </button>
        )}
        {list === null ? (
          <div className="flex flex-col gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
        ) : list.length === 0 ? (
          <EmptyState icon={<BellOff className="size-6" />} title="Nothing yet" body="Overtakes, earned packs and streak reminders will show up here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((n, i) => (
              <motion.li key={n.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <button
                  onClick={() => {
                    if (!n.read) markRead([n.id])
                    setNotif(false)
                    target(n)
                  }}
                  className={cn("flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-white/8", n.read ? "border-[var(--line)] bg-white/[0.03]" : "border-[var(--line-hi)] bg-[color-mix(in_oklab,var(--th-accent)_8%,transparent)]")}
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-muted-foreground"><NotifGlyph kind={n.kind} className="size-[18px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{fmtAgo(n.created_utc)}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{n.body}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--th-accent)]" />}
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
