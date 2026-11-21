import { Layers } from "lucide-react"
import { cn } from "@/lib/utils"

/** A restrained booster pack: matte gradient, hairline border, crimp lines. */
export function PackArt({ size = 120, className, label }: { size?: number; accent?: string; className?: string; label?: string }) {
  return (
    <div
      className={cn("relative flex shrink-0 flex-col items-center justify-center overflow-hidden rounded-[12px]", className)}
      style={{
        width: size,
        height: size * 1.42,
        background: "linear-gradient(160deg, color-mix(in oklab, var(--th-accent) 88%, white), var(--th-accent) 40%, color-mix(in oklab, var(--th-accent) 55%, black))",
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 28%), 0 12px 30px -14px rgb(0 0 0 / .8)",
        color: "var(--th-accent-fg)",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-[6%] bg-black/15" />
      <div className="absolute inset-x-0 bottom-0 h-[6%] bg-black/15" />
      <Layers style={{ width: size * 0.3, height: size * 0.3 }} strokeWidth={1.6} />
      {label && <div className="mt-1 font-semibold" style={{ fontSize: size * 0.13 }}>{label}</div>}
    </div>
  )
}
