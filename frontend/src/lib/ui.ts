import { create } from "zustand"

/** Cross-cutting UI flags that aren't route state. */
interface Ui {
  notifOpen: boolean
  moreOpen: boolean
  manualOpen: boolean
  openingGrant: import("./types").PackGrant | null
  setNotif: (v: boolean) => void
  setMore: (v: boolean) => void
  setManual: (v: boolean) => void
  openPack: (g: import("./types").PackGrant | null) => void
}

export const useUi = create<Ui>((set) => ({
  notifOpen: false,
  moreOpen: false,
  manualOpen: false,
  openingGrant: null,
  setNotif: (notifOpen) => set({ notifOpen }),
  setMore: (moreOpen) => set({ moreOpen }),
  setManual: (manualOpen) => set({ manualOpen }),
  openPack: (openingGrant) => set({ openingGrant }),
}))
