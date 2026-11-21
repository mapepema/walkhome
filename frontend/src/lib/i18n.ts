/** UI strings. Shell chrome (navigation, auth, core actions) goes through this
 * dictionary so another language can be added by registering a second `Dict`.
 * Journey prose comes from the content pack, already in the pack's language.
 * `useT()` re-renders on language change. */
import { useSyncExternalStore } from "react"

const en = {
  appTagline: "A quest, one step at a time",
  nav: { camp: "Camp", walk: "Walk", quests: "Quests", packs: "Packs", collection: "Collection", race: "Race", map: "Map", profile: "Profile", more: "More" },
  login: "Sign in",
  register: "Create account",
  username: "Username",
  password: "Password",
  chooseQuest: "Choose your quest",
  yourAvatar: "Your avatar",
  resumeRoad: "Back on the road",
  startAdventure: "Start the adventure",
  welcomePacks: "2 card packs offered at sign-up",
  walk: "Walk",
  resumeWalk: "Resume walk",
  startWalking: "Start walking",
  manualWalk: "Log a walk manually",
  pause: "Pause",
  resume: "Resume",
  endWalk: "End walk",
  claim: "Claim",
  open: "Open",
  later: "Later",
  nextMilestone: "Next milestone",
  nextPack: "Next pack",
  language: "Language",
  logout: "Sign out",
  notifications: "Notifications",
  settings: "Settings",
  activity: "Activity",
}

export type Lang = "en"
export type Dict = typeof en
const dicts: Record<Lang, Dict> = { en }
const subs = new Set<() => void>()

export function getLang(): Lang {
  return "en"
}

export function setLang(lang: Lang) {
  document.documentElement.lang = lang
  subs.forEach((f) => f())
}

export function dict(lang: Lang = getLang()): Dict {
  return dicts[lang]
}

export function useT(): Dict {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => dicts[getLang()])
}
