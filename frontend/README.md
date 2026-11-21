# Walkhome frontend

React 19 + Vite + Tailwind v4 + framer-motion + zustand + three.js. A mobile-first PWA
with a real desktop layout (>= 1024 px: left rail + panels).

## Commands

```bash
npm run dev          # proxies /api + /ws to :8090 (WALKHOME_API=http://localhost:8091 for another port)
npm run build        # tsc -b && vite build  (FastAPI serves dist/)
npm run lint         # oxlint
node scripts/make-icons.mjs   # regenerate public/icons (any + maskable)
```

## Mock mode (no backend)

`/?mock=1` (or `VITE_MOCK=1`) replaces `fetch` and `WebSocket` with an in-browser fake server (`src/lib/mock/`):
leaderboard, quests, notifications, walk simulator. `?mock=anon` starts signed out, `&busy=1`
makes the treadmill busy, `?mock=0` turns it off. Console helpers: `__mock.reward()`, `__mock.rank("overtook"|"overtaken")`,
`__mock.notify()`, `__mock.event()`, `__mock.choice()`, `__mock.challenge()`, `__mock.busy()`.

## Architecture

- `src/lib/`: `api.ts` (cookie, typed errors, global 401), `store.ts` (session, snapshot, WS, reward/rank/story queues),
  `ws.ts` (reconnect, sequence numbers, resync), `router.ts` (hash routes: `#/race/user/12`), `theme.ts` (CSS tokens derived from the biome),
  `i18n.ts` (app chrome strings), `tcg.ts` (single import point for `features/tcg`), `mock/`.
- `src/shell/`: navigation (bottom bar / rail), notification centre, overlays (pack earned, overtake, story/choice).
- `src/views/`: Auth, Camp, Walk, Quests, Race, MapView, Profile (+ subfolders). Heavy views are `lazy`;
  clean design (lucide icons, no decorative animation).
- `src/kit/`: primitives (Panel, Sheet, Ring, Bar, Avatar, QuestCard, pickers...).
- `src/features/tcg/`: the trading-card module (packs, collection, HoloCard, pack opening).
- Theme: `applyTheme(palette)` sets `--th-*` on `<html>` (`@property` declarations, smooth transitions between biomes).
