import { type ReactNode } from "react"
import { Dialog } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMedia } from "@/lib/hooks"

/** Responsive sheet. Phone: bottom sheet (drag handle, swipe down to close).
 * Desktop: `side` = right-hand panel, `modal` = centred dialog. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  variant = "side",
  className,
  hideTitle,
  locked,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  variant?: "side" | "modal"
  className?: string
  hideTitle?: boolean
  /** can't be dismissed (forced choice) */
  locked?: boolean
}) {
  const desktop = useMedia("(min-width: 1024px)")
  const reduce = useReducedMotion()
  const initial = desktop
    ? variant === "side"
      ? { x: 48, opacity: 0 }
      : { y: 16, opacity: 0, scale: 0.97 }
    : { y: "100%" }
  const shown = desktop ? { x: 0, y: 0, opacity: 1, scale: 1 } : { y: 0 }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && !locked && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[3px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                className={cn(
                  "glass fixed z-[61] flex flex-col overflow-hidden !bg-[var(--th-bg-2)] outline-none",
                  desktop
                    ? variant === "side"
                      ? "inset-y-3 right-3 w-[440px] max-w-[calc(100vw-1.5rem)] !rounded-3xl"
                      : "left-1/2 top-1/2 max-h-[86dvh] w-[520px] max-w-[calc(100vw-2rem)] !rounded-3xl"
                    : "inset-x-0 bottom-0 max-h-[92dvh] !rounded-b-none !rounded-t-3xl",
                  className,
                )}
                style={desktop && variant === "modal" ? { translate: "-50% -50%" } : undefined}
                initial={reduce ? false : initial}
                animate={shown}
                exit={reduce ? undefined : initial}
                transition={{ type: "spring", damping: 32, stiffness: 330 }}
                drag={desktop || locked ? false : "y"}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, i) => {
                  if (i.offset.y > 120 || i.velocity.y > 600) onClose()
                }}
                dragListener={false}
              >
                {!desktop && (
                  <div className="flex shrink-0 justify-center pt-2.5 pb-1" aria-hidden>
                    <span className="h-1 w-10 rounded-full bg-white/25" />
                  </div>
                )}
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-3 pb-2">
                  <div className={cn("min-w-0", hideTitle && "sr-only")}>
                    <Dialog.Title className="font-display text-lg font-semibold">{title}</Dialog.Title>
                    {description && (
                      <Dialog.Description className="mt-0.5 text-[13px] text-muted-foreground">
                        {description}
                      </Dialog.Description>
                    )}
                  </div>
                  {!locked && <Dialog.Close
                    aria-label="Close"
                    className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-white/8 text-muted-foreground transition-colors hover:bg-white/15 hover:text-foreground"
                  >
                    <X className="size-4" />
                  </Dialog.Close>}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--safe-bottom))]">
                  {children}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
