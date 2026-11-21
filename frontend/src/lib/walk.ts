import { useState } from "react"
import { ApiError, errMsg, post } from "./api"
import { navigate } from "./router"
import { haptic } from "./haptics"
import { toast } from "sonner"
import { useStore } from "./store"

/** Starts a walk on the treadmill; explains a busy belt instead of failing silently. */
export function useStartWalk() {
  const [busy, setBusy] = useState(false)
  const refresh = useStore((s) => s.refresh)
  const start = async () => {
    setBusy(true)
    haptic.success()
    try {
      await post("/me/walk/start")
      await refresh()
      navigate("walk")
    } catch (e) {
      if (e instanceof ApiError && e.code === "treadmill_busy") {
        toast.warning("The treadmill is busy", { description: "Another player is walking right now." })
        refresh()
        navigate("walk")
      } else toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }
  return { start, busy }
}
