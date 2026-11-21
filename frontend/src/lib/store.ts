/** App store: session, server snapshot, WebSocket events and transient UI
 * queues (rewards, rank events, story cards). The server is the single source
 * of truth; the socket sends a full snapshot on connect and on "resync". */
import { create } from "zustand"
import { api, errMsg, post, setUnauthorizedHandler } from "./api"
import { WalkSocket, type Envelope } from "./ws"
import { applyTheme, fallbackPalette } from "./theme"
import { haptic } from "./haptics"
import { toast } from "sonner"
import type {
  AppNotification,
  ChallengeResult,
  Journey,
  JourneyEvent,
  Me,
  PendingChoice,
  PresenceWalker,
  RankEvent,
  RewardEvent,
  Snapshot,
  ThemeInfo,
  Units,
} from "./types"

export interface StoryCard {
  key: string
  icon: string
  title: string
  body: string
  meta?: string
}

interface Store {
  booted: boolean
  me: Me | null
  snap: Snapshot | null
  journey: Journey | null
  themes: ThemeInfo[]
  wsOpen: boolean
  live: PresenceWalker[]
  rewards: RewardEvent[]
  rankEvents: RankEvent[]
  cards: StoryCard[]
  challengeResult: ChallengeResult | null
  notifications: AppNotification[] | null
  unread: number
  /** bumped when something happened that lists should re-fetch */
  dataVersion: number

  boot: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (body: Record<string, unknown>) => Promise<void>
  logout: () => Promise<void>
  patchMe: (body: Record<string, unknown>) => Promise<void>
  refresh: () => Promise<void>
  resync: () => void
  loadThemes: () => Promise<void>
  loadNotifications: () => Promise<void>
  markRead: (ids?: number[]) => Promise<void>
  shiftReward: () => void
  shiftRank: () => void
  shiftCard: () => void
  pushCard: (c: StoryCard) => void
  dismissChallengeResult: () => void
  bump: () => void
}

let socket: WalkSocket | null = null
const shownEvents = new Set<string>()
const journeyCache = new Map<string, Journey>()

/** Keep the previous object when the new one is structurally identical so
 * 1 Hz ticks don't re-render subscribers of slow-moving slices. */
function keep<T>(prev: T | undefined, next: T): T {
  if (prev === undefined) return next
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next
}

function mergeSnap(prev: Snapshot | null, data: Partial<Snapshot>): Snapshot {
  if (!prev) return data as Snapshot
  const out: Snapshot = { ...prev }
  for (const k of Object.keys(data) as (keyof Snapshot)[]) {
    const v = data[k]
    if (v === undefined) continue
    // session carries the 1 Hz telemetry: always replace
    ;(out as any)[k] = k === "session" ? v : keep(prev[k], v as never)
  }
  return out
}

export const useStore = create<Store>((set, get) => ({
  booted: false,
  me: null,
  snap: null,
  journey: null,
  themes: [],
  wsOpen: false,
  live: [],
  rewards: [],
  rankEvents: [],
  cards: [],
  challengeResult: null,
  notifications: null,
  unread: 0,
  dataVersion: 0,

  async boot() {
    setUnauthorizedHandler(() => {
      if (get().me) {
        toast("Session expired", { description: "Sign in again to continue." })
        teardown(set)
      }
    })
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && get().me) get().resync()
    })
    get().loadThemes().catch(() => {})
    try {
      const me = await api<Me>("/auth/me", { silent401: true })
      await enter(me, set, get)
    } catch {
      /* not logged in */
    }
    set({ booted: true })
  },

  async login(username, password) {
    const me = await api<Me>("/auth/login", {
      method: "POST",
      body: { username, password },
      silent401: true,
    })
    await enter(me, set, get)
  },

  async register(body) {
    const me = await api<Me>("/auth/register", { method: "POST", body, silent401: true })
    await enter(me, set, get)
  },

  async logout() {
    try {
      await post("/auth/logout")
    } catch {
      /* ignore */
    }
    teardown(set)
  },

  async patchMe(body) {
    const me = await api<Me>("/me", { method: "PATCH", body })
    set({ me })
    await get().refresh()
    if (body.journey_id) await loadJourney(me.journey_id, set)
  },

  async refresh() {
    try {
      const snap = await api<Snapshot>("/me/state")
      applySnapshot(snap, set)
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "ApiError") console.warn(errMsg(e))
    }
  },

  resync() {
    if (socket?.isOpen) socket.resync()
    else get().refresh()
  },

  async loadThemes() {
    const themes = await api<ThemeInfo[]>("/themes", { silent401: true })
    set({ themes: themes.map((t) => ({ ...t, palette: t.palette ?? fallbackPalette(t.id) })) })
  },

  async loadNotifications() {
    const list = await api<AppNotification[]>("/me/notifications?limit=50")
    set({ notifications: list, unread: list.filter((n) => !n.read).length })
  },

  async markRead(ids) {
    await post("/me/notifications/read", ids ? { ids } : { all: true })
    set((s) => ({
      notifications:
        s.notifications?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ??
        null,
      unread: ids ? Math.max(0, s.unread - ids.length) : 0,
    }))
  },

  shiftReward: () => set((s) => ({ rewards: s.rewards.slice(1) })),
  shiftRank: () => set((s) => ({ rankEvents: s.rankEvents.slice(1) })),
  shiftCard: () => set((s) => ({ cards: s.cards.slice(1) })),
  pushCard: (c) => set((s) => ({ cards: [...s.cards, c] })),
  dismissChallengeResult: () => set({ challengeResult: null }),
  bump: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
}))

type Set = (fn: Partial<Store> | ((s: Store) => Partial<Store>)) => void
type Get = () => Store

async function enter(me: Me, set: Set, get: Get) {
  set({ me })
  await loadJourney(me.journey_id, set)
  await get().refresh()
  startSocket(set, get)
}

function teardown(set: Set) {
  socket?.stop()
  socket = null
  shownEvents.clear()
  set({
    me: null,
    snap: null,
    journey: null,
    wsOpen: false,
    live: [],
    rewards: [],
    rankEvents: [],
    cards: [],
    notifications: null,
    unread: 0,
  })
  applyTheme(null)
  if (location.hash && !location.hash.startsWith("#/auth")) location.hash = ""
}

async function loadJourney(id: string, set: Set) {
  let j = journeyCache.get(id)
  if (!j) {
    j = await api<Journey>(`/journeys/${id}`)
    journeyCache.set(id, j)
  }
  set({ journey: j })
}

function applySnapshot(snap: Snapshot, set: Set) {
  set((s) => ({
    snap,
    me: snap.me ?? s.me,
    unread: snap.unread_notifications ?? s.unread,
  }))
}

function startSocket(set: Set, get: Get) {
  socket?.stop()
  socket = new WalkSocket({
    onOpen: () => set({ wsOpen: true }),
    onClose: () => set({ wsOpen: false }),
    onUnauthorized: () => teardown(set),
    onMessage: (env) => handleMessage(env, set, get),
  })
  socket.start()
}

function handleMessage(env: Envelope, set: Set, get: Get) {
  const { type, data } = env
  switch (type) {
    case "snapshot":
      applySnapshot(data as Snapshot, set)
      if (data.journey_id && data.journey_id !== get().journey?.id)
        loadJourney(data.journey_id, set).catch(() => {})
      break
    case "tick":
      set((s) => ({ snap: mergeSnap(s.snap, data) }))
      break
    case "live":
      set((s) => ({ live: keep(s.live, data.walkers ?? []) }))
      break
    case "reward": {
      haptic.reward()
      set((s) => ({ rewards: [...s.rewards, data as RewardEvent] }))
      get().refresh()
      get().bump()
      break
    }
    case "rank": {
      const ev = data as RankEvent
      if (ev.overtook) haptic.success()
      else haptic.warn()
      set((s) => ({ rankEvents: [...s.rankEvents, ev] }))
      get().bump()
      break
    }
    case "notify": {
      const n = data as AppNotification
      set((s) => ({
        notifications: s.notifications ? [n, ...s.notifications] : s.notifications,
        unread: s.unread + 1,
      }))
      if (n.kind !== "pack" && n.kind !== "rank_overtake")
        toast(n.title, { description: n.body, icon: n.icon })
      break
    }
    case "event":
      onStoryEvent(data, set, get)
      break
    case "challenge":
      if (data.phase === "started") break // running state arrives via the tick
      set({
        challengeResult: {
          title: data.title,
          icon: data.icon,
          succeeded: !!data.succeeded,
          text: data.text ?? "",
          held_s: data.held_s ?? 0,
        },
      })
      if (data.succeeded) haptic.success()
      else haptic.warn()
      get().bump()
      break
  }
}

function onStoryEvent(
  p: { subject?: { kind: string; id: number }; event: JourneyEvent; at_m: number },
  _set: Set,
  get: Get,
) {
  const meId = get().me?.id
  const key = `${p.subject?.id ?? meId}:${p.event.id}`
  if (shownEvents.has(key)) return
  shownEvents.add(key)
  const ev = p.event
  if (ev.kind === "challenge") return // own HUD
  if (ev.kind === "choice" && get().snap?.session) return // rendered from pending_choice
  haptic.select()
  get().pushCard({
    key,
    icon: ev.icon || "📜",
    title: ev.title,
    body: ev.body,
    meta: ev.approx ? "≈" : ev.kind === "milestone" ? "Milestone reached" : undefined,
  })
  get().bump()
}

/* ------------------------------------------------------------ selectors -- */

export const selUnits = (s: Store): Units => s.snap?.units ?? s.me?.units ?? "km"
export const selSession = (s: Store) => s.snap?.session ?? null
export const selPending = (s: Store): PendingChoice | null =>
  s.snap?.session?.pending_choice ?? null
