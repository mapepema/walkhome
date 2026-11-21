import { useEffect, useState } from "react"
import { cachedCatalog, fetchCatalog } from "../store"
import type { CardCatalog, CardSetDef, PackGrant } from "../types"

/** Set (accent, cover) used to dress a pack, according to the PACK's theme. */
export function usePackSet(grant: PackGrant): { set?: CardSetDef; catalog: CardCatalog | null } {
  const [catalog, setCatalog] = useState<CardCatalog | null>(() => cachedCatalog(grant.theme) ?? null)
  useEffect(() => {
    let alive = true
    fetchCatalog(grant.theme)
      .then((c) => alive && setCatalog(c))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [grant.theme])
  return { set: catalog ? catalog.sets[grant.id % Math.max(1, catalog.sets.length)] : undefined, catalog }
}
