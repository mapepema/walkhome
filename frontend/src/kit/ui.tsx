import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { avatarIcon } from "./icons"

export function Panel({
  className,
  children,
  hi,
  style,
  ...rest
}: { className?: string; children: ReactNode; hi?: boolean; style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass", hi && "glass-hi", className)} style={style} {...rest}>
      {children}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("eyebrow", className)}>{children}</div>
}

export function SectionHead({
  title,
  action,
  className,
}: {
  title: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>
      {action}
    </div>
  )
}

export function PageTitle({
  title,
  sub,
  right,
}: {
  title: ReactNode
  sub?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display truncate text-[32px] leading-tight lg:text-[40px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton", className)} style={style} aria-hidden />
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}>
      <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-white/7 text-muted-foreground">
        {icon}
      </div>
      <div className="text-base font-semibold">{title}</div>
      {body && <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Avatar: a clean icon in a softly tinted disc. */
export function Avatar({
  emoji,
  color,
  size = 40,
  ring,
  live,
  className,
}: {
  emoji: string
  color: string
  size?: number
  ring?: boolean
  live?: boolean
  className?: string
}) {
  const Icon = avatarIcon(emoji)
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(160deg, ${color}38, ${color}18)`,
        color,
        boxShadow: ring ? `inset 0 0 0 2px ${color}` : `inset 0 0 0 1px ${color}55`,
      }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.8} aria-hidden />
      {live && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-[var(--th-bg)] bg-emerald-400" />}
    </span>
  )
}

/** Circular progress ring with centred content. */
export function Ring({
  value,
  size = 96,
  stroke = 8,
  children,
  className,
}: {
  value: number
  size?: number
  stroke?: number
  children?: ReactNode
  className?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id={`rg${size}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--th-accent)" />
            <stop offset="1" stopColor="var(--th-accent-2)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(1 0 0 / 9%)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--th-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

/** Horizontal bar with a gold gradient fill. */
export function Bar({ value, className, height = 8 }: { value: number; className?: string; height?: number }) {
  return (
    <div
      className={cn("overflow-hidden rounded-full bg-white/10", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="relative h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          background: "var(--th-accent)",
          transition: "width .8s cubic-bezier(.2,.8,.2,1)",
        }}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cn("inline-flex rounded-full border border-[var(--line)] bg-white/5 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
            value === o.value ? "btn-gold" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ children, className, tone }: { children: ReactNode; className?: string; tone?: "gold" | "win" | "lose" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone === "win" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
        tone === "lose" && "border-red-400/30 bg-red-400/10 text-red-300",
        (!tone || tone === "gold") && "border-[var(--line-hi)] bg-[color-mix(in_oklab,var(--th-accent)_10%,transparent)] text-gold",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function ErrorLine({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-200">
      <span>{message}</span>
      {retry && (
        <button onClick={retry} className="font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  )
}
