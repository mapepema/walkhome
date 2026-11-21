import { useEffect, useMemo } from "react"
import { useTcg } from "../store"
import type { CardCatalog, CardDef, CardSetDef } from "../types"

export interface CatalogApi {
  catalog: CardCatalog | null
  cards: CardDef[]
  sets: CardSetDef[]
  loading: boolean
  error: string | null
  cardById: (id: string) => CardDef | undefined
  reload: () => void
}

/**
 * Catalog of the user's theme. Memory cache (module) + HTTP cache (ETag,
 * handled by the browser: the route answers `max-age=3600`).
 */
export function useCatalog(): CatalogApi {
  const catalog = useTcg((s) => s.catalog)
  const byId = useTcg((s) => s.byId)
  const loading = useTcg((s) => s.catalogLoading)
  const error = useTcg((s) => s.catalogError)
  const load = useTcg((s) => s.loadCatalog)

  useEffect(() => {
    void load()
  }, [load])

  return useMemo<CatalogApi>(
    () => ({
      catalog,
      cards: catalog?.cards ?? [],
      sets: catalog?.sets ?? [],
      loading,
      error,
      cardById: (id) => byId.get(id),
      reload: () => {
        useTcg.setState({ catalog: null, catalogError: null })
        void useTcg.getState().loadCatalog()
      },
    }),
    [catalog, byId, loading, error],
  )
}
