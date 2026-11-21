import { create } from "zustand"
import { NetError, request } from "./net"
import type {
  CardCatalog,
  CardDef,
  CollectionResponse,
  EconomyResponse,
  OpenResult,
  PackGrant,
  PacksResponse,
} from "./types"

export interface PendingReveal {
  grant: PackGrant
  result: OpenResult
}

const PENDING_KEY = "wh-tcg-pending"

export function readPending(): PendingReveal | null {
  try {
    const s = localStorage.getItem(PENDING_KEY)
    return s ? (JSON.parse(s) as PendingReveal) : null
  } catch {
    return null
  }
}
export function writePending(p: PendingReveal | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* quota / private mode */
  }
}

export const cachedCatalog = (theme: string) => catalogMemo.get(theme)

interface TcgState {
  catalog: CardCatalog | null
  byId: Map<string, CardDef>
  catalogError: string | null
  catalogLoading: boolean
  collection: CollectionResponse | null
  packs: PacksResponse | null
  economy: EconomyResponse | null
  error: string | null
  pending: PendingReveal | null

  loadCollection: () => Promise<void>
  loadCatalog: () => Promise<void>
  loadPacks: () => Promise<void>
  loadEconomy: () => Promise<void>
  refreshAll: () => Promise<void>
  craft: (cardId: string) => Promise<void>
  openPack: (grant: PackGrant) => Promise<OpenResult>
  setPending: (p: PendingReveal | null) => void
}

const catalogMemo = new Map<string, CardCatalog>()
let catalogInflight: Promise<void> | null = null

/** Catalog of one theme (memory + HTTP/ETag cache): a pack may come from a theme other than the active one. */
export async function fetchCatalog(theme: string): Promise<CardCatalog> {
  let cat = catalogMemo.get(theme)
  if (!cat) {
    cat = await request<CardCatalog>(`/themes/${encodeURIComponent(theme)}/cards`)
    catalogMemo.set(theme, cat)
  }
  return cat
}

/** Results already obtained: `open` is NEVER called twice for the same pack. */
const openResults = new Map<number, OpenResult>()
const openInflight = new Map<number, Promise<OpenResult>>()

export const useTcg = create<TcgState>((set, get) => ({
  catalog: null,
  byId: new Map(),
  catalogError: null,
  catalogLoading: false,
  collection: null,
  packs: null,
  economy: null,
  error: null,
  pending: readPending(),

  loadCollection: async () => {
    try {
      const collection = await request<CollectionResponse>("/me/collection")
      set({ collection, error: null })
    } catch (e) {
      set({ error: e instanceof NetError ? e.message : "Unknown error" })
    }
  },

  loadCatalog: async () => {
    const have = get().catalog
    if (have && (!get().collection || get().collection!.theme === have.theme)) return
    if (catalogInflight) return catalogInflight
    catalogInflight = (async () => {
      set({ catalogLoading: true, catalogError: null })
      try {
        if (!get().collection) await get().loadCollection()
        const theme = get().collection?.theme
        if (!theme) throw new NetError("Unknown theme (collection unavailable)", 0)
        const cat = await fetchCatalog(theme)
        set({ catalog: cat, byId: new Map(cat.cards.map((c) => [c.id, c])), catalogLoading: false })
      } catch (e) {
        set({ catalogError: e instanceof NetError ? e.message : "Catalog unavailable", catalogLoading: false })
      } finally {
        catalogInflight = null
      }
    })()
    return catalogInflight
  },

  loadPacks: async () => {
    try {
      set({ packs: await request<PacksResponse>("/me/packs"), error: null })
    } catch (e) {
      set({ error: e instanceof NetError ? e.message : "Unknown error" })
    }
  },

  loadEconomy: async () => {
    if (get().economy) return
    try {
      set({ economy: await request<EconomyResponse>("/me/economy") })
    } catch {
      set({ economy: {} })
    }
  },

  refreshAll: async () => {
    await Promise.all([get().loadCollection(), get().loadPacks()])
  },

  craft: async (cardId) => {
    const res = await request<{ card_id: string; essence: number }>("/me/craft", {
      method: "POST",
      body: { card_id: cardId },
    })
    const col = get().collection
    if (col) {
      const prev = col.owned[cardId]
      const owned = { ...col.owned, [cardId]: { count: (prev?.count ?? 0) + 1, first_utc: prev?.first_utc ?? new Date().toISOString() } }
      set({ collection: { ...col, owned, essence: res.essence } })
    }
    void get().loadCollection()
  },

  openPack: (grant) => {
    const done = openResults.get(grant.id)
    if (done) return Promise.resolve(done)
    const pend = get().pending
    if (pend && pend.grant.id === grant.id) return Promise.resolve(pend.result)
    const running = openInflight.get(grant.id)
    if (running) return running
    const p = request<OpenResult>(`/me/packs/${grant.id}/open`, { method: "POST" })
      .then((result) => {
        openResults.set(grant.id, result)
        // Keep the draw until the reveal is finished.
        const pending = { grant, result }
        writePending(pending)
        set({ pending })
        // The server has already credited the collection: resync in the background.
        void get().refreshAll()
        return result
      })
      .finally(() => openInflight.delete(grant.id))
    openInflight.set(grant.id, p)
    return p
  },

  setPending: (p) => {
    writePending(p)
    set({ pending: p })
  },
}))
