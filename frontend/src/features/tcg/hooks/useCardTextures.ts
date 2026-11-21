import { useEffect, useState } from "react"
import type { CardDef } from "../types"
import { acquireTextures, releaseTextures, type CardTextures } from "../scene/cardTextures"

/** GPU textures of a card (reference-counted, LRU eviction). */
export function useCardTextures(card: CardDef | null): CardTextures | null {
  const [state, setState] = useState<{ id: string; tex: CardTextures } | null>(null)
  useEffect(() => {
    if (!card) return
    let cancelled = false
    void acquireTextures(card).then((tex) => {
      if (!cancelled) setState({ id: card.id, tex })
    })
    return () => {
      cancelled = true
      releaseTextures(card)
    }
  }, [card])
  return card && state && state.id === card.id ? state.tex : null
}
