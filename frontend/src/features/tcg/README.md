# TCG module

Exports (`index.ts`): `PacksView`, `CollectionView`, `HoloCard`, `CardDetailDialog`, `PackOpeningOverlay`, `useCatalog`, types.

## Architecture
- `types.ts` contract types; `net.ts` fetch + session cookie (in `?mock=1` mode the app-wide mock intercepts `fetch`); `store.ts` zustand store (collection, packs, catalog, pending draw persisted in `localStorage` under `wh-tcg-pending`).
- **Grids are CSS** (`components/HoloCard.tsx` + `tcg.css`): 3D tilt, foil gradients masked to `art_rect`, iridescent rim, silhouette when missing. No WebGL context per card.
- **WebGL only** for the detail view (`scene/CardScene`) and the pack opening (`opening/OpeningScene`): a single Canvas at a time.
- Material `scene/HoloCardMaterial.ts` (MeshPhysicalMaterial + chunks in `src/shaders/holo_*.glsl`). Per-card textures (`scene/cardTextures.ts`): albedo = image; RG holo mask (R = `art_rect` softened by signed distance, G = frame/border band); Sobel normal map on luminance; LRU cache with reference counting.
- Fully local lighting environment (Lightformers, no network HDRI). `lib/quality.ts` (`?quality=low|medium|high`); `prefers-reduced-motion` is respected.
- Opening: `POST /me/packs/{id}/open` is called ONCE (memo + in-flight guard + persisted draw); a network error shows "Retry" without losing anything; resume from `PacksView`.
- Collection: in-house windowing (`hooks/useVirtualGrid.ts`), tested with ~1,700 cards; `thumb` images use `loading=lazy`.

## Adding a treatment / foil
`scene/treatments.ts`: `FOIL_BY_KIND` (new foil + `Foil` type), `RARITY_BOOST` (per-rarity tuning, aura, particles), spectra in `scene/spectra.ts`, per-foil mask in `buildMasks` (`cardTextures.ts`), CSS equivalent in `tcg.css` (`[data-foil=…]`).

## Measurements (SwiftShader on CPU, not representative of a GPU)
- Detail: 5–7 draw calls, ~940 triangles, 12 textures. Reveal: ~27 draw calls, ~4.7k triangles. Software FPS 6–24 (CPU); a mobile GPU is expected well above 30.
- Memory: ~2.5 MB of GPU memory per active card, at most 10 inactive cards cached.
