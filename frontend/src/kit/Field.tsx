import { useId, type InputHTMLAttributes, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Field({ label, hint, error, right, className, ...props }: { label: string; hint?: ReactNode; error?: string | null; right?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{label}</label>
        {right}
      </div>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? id + "d" : undefined}
        {...props}
        className="h-12 w-full rounded-xl border border-[var(--line)] bg-black/25 px-3.5 text-[15px] text-foreground outline-none transition-all placeholder:text-muted-foreground/60 focus:border-[var(--th-accent)] focus:bg-black/35 focus:shadow-[0_0_0_3px_var(--th-glow)] aria-[invalid=true]:border-red-400/60"
      />
      {(hint || error) && (
        <div id={id + "d"} className={cn("text-[11px]", error ? "text-red-300" : "text-muted-foreground")}>{error ?? hint}</div>
      )}
    </div>
  )
}
