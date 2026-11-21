import { motion } from "framer-motion"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { fmtDist } from "@/lib/format"
import { haptic } from "@/lib/haptics"
import type { ThemeInfo } from "@/lib/types"
import { AVATAR_IDS, AVATAR_ICONS } from "./icons"

export const COLORS = ["#e3b45c", "#f472b6", "#60a5fa", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#2dd4bf"]

export function ThemePicker({ themes, value, onChange, compact }: { themes: ThemeInfo[]; value: string; onChange: (t: ThemeInfo) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("grid gap-3", compact ? "grid-cols-2" : "sm:grid-cols-2")}>
      {themes.map((t) => {
        const on = t.id === value
        return (
          <motion.button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={on}
            whileTap={{ scale: 0.98 }}
            onClick={() => { haptic.select(); onChange(t) }}
            className={cn("relative overflow-hidden rounded-2xl border text-left transition-all", on ? "border-[var(--th-accent)] shadow-[0_0_0_1px_var(--th-accent),0_12px_36px_-12px_var(--th-glow)]" : "border-[var(--line)] opacity-80 hover:opacity-100")}
          >
            <div className={cn("w-full", compact ? "h-14" : "h-20")} style={{ background: t.palette ? `linear-gradient(135deg, ${t.palette.sky[0]}, ${t.palette.far} 55%, ${t.palette.near})` : "#333" }} />
            <div className="bg-[var(--th-bg-2)] p-3">
              <div className="text-[14px] font-semibold leading-tight">{t.name}</div>
              <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{t.subtitle}</div>
              {!compact && (
                <div className="tnum mt-2 flex gap-3 text-[11px] text-muted-foreground">
                  <span>{fmtDist(t.total_m, "km", 0)}</span>
                  <span>{t.card_count} cards</span>
                </div>
              )}
            </div>
            {on && <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-[var(--th-accent)] text-[var(--th-accent-fg)]"><Check className="size-3.5" strokeWidth={3} /></span>}
          </motion.button>
        )
      })}
    </div>
  )
}

export function AvatarPicker({ avatar, color, onAvatar, onColor }: { avatar: string; color: string; onAvatar: (a: string) => void; onColor: (c: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Avatar">
        {AVATAR_IDS.map((a) => { const I = AVATAR_ICONS[a]; return (
          <button key={a} type="button" role="radio" aria-checked={a === avatar} onClick={() => { haptic.tap(); onAvatar(a) }}
            className={cn("flex aspect-square items-center justify-center rounded-xl text-muted-foreground transition-colors", a === avatar ? "bg-white/12 ring-2" : "bg-white/5 hover:bg-white/10")}
            style={a === avatar ? { boxShadow: `0 0 0 2px ${color}` } : undefined}>
            <I className="size-5" strokeWidth={1.8} style={{ color: a === avatar ? color : undefined }} />
          </button>
        )})}
      </div>
      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} onClick={() => { haptic.tap(); onColor(c) }}
            className={cn("size-8 rounded-full", c === color && "ring-2 ring-white ring-offset-2 ring-offset-[var(--th-bg)]")}
            style={{ background: c }} />
        ))}
      </div>
    </div>
  )
}
