/** Tiny hash router: `#/camp`, `#/race/user/12`, `#/profile/settings`. Deep
 * links survive reloads and the mobile back button works for free. */
import { useSyncExternalStore } from "react"

export type Tab =
  | "camp"
  | "walk"
  | "quests"
  | "packs"
  | "collection"
  | "race"
  | "map"
  | "profile"

export const TABS: Tab[] = ["camp", "walk", "quests", "packs", "collection", "race", "map", "profile"]

export interface Route {
  tab: Tab
  /** remaining path segments, e.g. ["user","12"] */
  rest: string[]
  query: URLSearchParams
}

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, "")
  const [path, q = ""] = raw.split("?")
  const parts = path.split("/").filter(Boolean)
  const tab = (TABS as string[]).includes(parts[0]) ? (parts[0] as Tab) : "camp"
  return { tab, rest: parts.slice(1), query: new URLSearchParams(q) }
}

let cached = parse()
let cachedKey = location.hash
const subs = new Set<() => void>()
window.addEventListener("hashchange", () => {
  cachedKey = location.hash
  cached = parse()
  subs.forEach((f) => f())
})

function subscribe(fn: () => void) {
  subs.add(fn)
  return () => subs.delete(fn)
}
function snapshot() {
  if (cachedKey !== location.hash) {
    cachedKey = location.hash
    cached = parse()
  }
  return cached
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot)
}

export function getRoute(): Route {
  return snapshot()
}

export function href(tab: Tab, ...rest: string[]): string {
  return `#/${[tab, ...rest].join("/")}`
}

export function navigate(tab: Tab, ...rest: string[]) {
  const h = href(tab, ...rest)
  if (location.hash !== h) location.hash = h
}

/** Go back if we have in-app history, else to the camp. */
export function back(fallback: Tab = "camp") {
  if (history.length > 1) history.back()
  else navigate(fallback)
}
