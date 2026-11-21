# Walkhome v2 — integration contract

Shared source of truth between the **backend**, the **frontend shell**, the
**frontend TCG module** and the **assets** pipeline. Any deviation must be
recorded here.

## 0. Principles

- **One app, isolated accounts.** Everyone who signs up gets an account (username + password).
  Every `/api/me/*` route is scoped to the authenticated user; no route takes an
  arbitrary `user_id` to read private data. Other players are only visible through their
  **public profile** (section 2.3) and the leaderboard.
- **Theme = journey pack** (`content/<id>.json`; the default is `camino`).
  A theme also has a **card catalog** (`content/cards/<id>.json`, section 3).
  The theme is data, never code: no place names or prose in `app/`.
- **Progress stays derived** (sum of sessions + adjustments × handicap), per
  `(user, journey)`. Distance packs are derived too (idempotent).
- **The server rolls the cards** (server-side RNG, anti-cheat). The client only
  animates the result.
- **The treadmill is read-only** (hard rule: never write to the FTMS Control Point).
- Timestamps are UTC ISO-8601; the UI renders local time.
- No external network dependency except Web Push (optional, VAPID).

## 1. Authentication

- `POST /api/auth/register` `{username, password, journey_id, avatar?, color?}` → `Me` + cookie.
  - `username` 3-24 chars `[A-Za-z0-9_.-]`, unique case-insensitively. `password` ≥ 8.
  - The first account created gets `is_admin = true`.
  - Registration can be restricted: env `WALKHOME_REGISTRATION=open|invite|closed` (default `open`);
    `invite` requires `invite_code` (= env `WALKHOME_INVITE_CODE`).
- `POST /api/auth/login` `{username, password}` → `Me` + cookie. Rate limited (5 failures/min per IP+user).
- `POST /api/auth/logout` → `{ok:true}`.
- `GET /api/auth/me` → `Me` or 401.
- Session: cookie `wh_session` (HttpOnly, SameSite=Lax, Secure when HTTPS is detected through
  `x-forwarded-proto`), random 32-byte token, **only its SHA-256 hash is stored**, 90-day sliding lifetime.
  The `Authorization: Bearer <token>` header is accepted too. Passwords: `hashlib.scrypt` + salt.
- Every route except `/api/auth/*`, `/api/health` and `/api/themes*` (public list) requires a session (401 otherwise).
- The `/ws` WebSocket reads the cookie; without a valid session it closes with code 4401.

## 2. JSON models

### 2.1 `Me`
```ts
interface Me {
  id: number; username: string; display_name: string
  avatar: string            // emoji or avatar id
  color: string             // #rrggbb
  journey_id: string        // active theme
  is_admin: boolean
  handicap: number; daily_goal_m: number
  units: "km" | "mi"
  created_utc: string
  wallet: { essence: number }
  unopened_packs: number
  push: { supported: boolean; subscribed: boolean }
}
```
### 2.2 `Subject` (the user's progress on their theme): see `frontend/src/lib/types.ts`.

### 2.3 `PublicProfile`
```ts
interface PublicProfile {
  id: number; username: string; display_name: string; avatar: string; color: string
  journey_id: string
  progress_m: number; fraction: number
  stage_name: string | null; biome_name: string | null
  streak_days: number
  cards_owned: number; cards_total: number     // on their theme
  walking_now: boolean
  best_rarity: Rarity | null
}
```
A public profile never contains session history, weight, heart rate or notes.

## 3. Cards (TCG)

```ts
type Rarity = "common" | "uncommon" | "rare" | "holo" | "ultra" | "secret"
type Foil = "none" | "linear" | "cosmos" | "rainbow" | "reverse"

interface CardDef {
  id: string               // "<theme>:<set>:<slug>"  e.g. "camino:em:emberling"
  theme: string; set: string; number: number
  name: string; subtitle?: string; type?: string
  rarity: Rarity; foil: Foil
  image: string            // full card albedo  /cards/<theme>/<set>/<slug>.webp  (≈ 480×672)
  thumb: string            // /cards/<theme>/<set>/<slug>.thumb.webp  (≈ 240×336)
  art_rect?: [number, number, number, number]  // normalised x,y,w,h (0..1) of the artwork area (holo mask)
  flavor?: string; artist?: string
  stats?: Record<string, number | string>
}
interface CardSetDef {
  id: string; theme: string; name: string; card_count: number; accent: string  // wrapper colour
  cover?: string           // wrapper image /cards/<theme>/<set>/pack.webp (optional)
}
interface CardCatalog { theme: string; sets: CardSetDef[]; cards: CardDef[]
  pack: { cards_per_pack: 5; slots: { label: string; odds: Partial<Record<Rarity, number>> }[] ;
          pity: { rare_every: number; ultra_every: number } } }
```
- File: `content/cards/<theme>.json` (same schema as `CardCatalog`). Images live
  in `frontend/public/cards/<theme>/…` (served as-is by FastAPI through `dist`).

**Asset notes** (`tools/build_cards_*.mjs`, details in `docs/CARDS.md`):
- `camino`: the "Embers & Peaks" deck, 120 cards, sets `em` Embers and `pk` Peaks (assets in `/cards/embers-peaks/`); `art_rect` = `[0.075,0.115,0.85,0.5]`.
- The `pack.webp` wrappers are 360×640 with **alpha** (transparent crimped edges).
- Pack slots = 3 × {common 70, uncommon 30} + {rare 84, holo 12, ultra 3.5, secret 0.5} + wildcard (default odds below).

- API: `GET /api/themes` (public list: journeys + `card_count`), `GET /api/themes/{id}/cards` → `CardCatalog`
  (public, `max-age=3600`, ETag).

### Drawing a pack (server)
5 cards; slots: 3 commons/uncommons, 1 "rare or better" slot, 1 "wildcard" slot (holo/ultra/secret possible).
Default wildcard odds: common 0, uncommon 40, rare 40, holo 15, ultra 4.5, secret 0.5.
Pity: a pack guarantees ≥ `rare` every 5 openings and ≥ `ultra` every 25 (counters stored in the database).
Packs are drawn from the catalog of the **pack's theme** (fixed when it is granted).
Duplicate → `+essence`: common 5, uncommon 10, rare 25, holo 60, ultra 150, secret 400 (the card still counts +1).
**Craft**: `POST /api/me/craft {card_id}` creates a *missing* card for **4 × the duplicate value** of its rarity (common 20, uncommon 40, rare 100, holo 240, ultra 600; costs exposed by `GET /api/me/economy`); not allowed for `secret`; refused if already owned.

## 4. Rewards (what grants packs)

Every grant is **idempotent** through a UNIQUE key on `pack_grants(user_id, source, source_key)`.

| source | key | rule |
|---|---|---|
| `distance` | `<theme>:<n>` (threshold number) | 1 pack every `pack_every_m` (default **2,000 m**, per theme in the content pack's `rewards.pack_every_m`) of credited distance |
| `daily` | `YYYY-MM-DD` | first km of the day (local day, `WALKHOME_TZ`, default Europe/Paris) |
| `streak` | `N` | streak tiers at 3, 7, 14, 30, 60, 100 days |
| `quest` | `quest_id:period` | daily/weekly quest claimed (section 5) |
| `milestone` | `<theme>:<event_id>` | `kind=milestone` event crossed in the journey |
| `album` | `<theme>:<set>:25|50|75|100` | set completion |
| `rank` | `<theme>:YYYY-Www:place` (podium) / `overtake:<victimId>:YYYY-MM-DD` | overtaking a player (max 3 per day); weekly podium (1st = 3 packs, 2nd = 2, 3rd = 1) |
| `welcome` | `1`, `2` | 2 packs at sign-up |

Manual distance (`source='manual'`) counts for progress and the leaderboard but is **capped for rewards** at
`manual_reward_cap_m` = 5,000 m/day; maximum implied speed 12 km/h, otherwise it is worth 400 m.
A pack: `PackGrant {id, theme, source, source_key, title, created_utc, opened_utc|null}`.

## 5. Quests
```ts
interface Quest {
  id: string; period: "daily" | "weekly" | "story"; icon: string
  title: string; description: string
  target: number; progress: number; unit: "m" | "count" | "days" | "s"
  reward: { packs?: number; essence?: number }
  claimable: boolean; claimed: boolean; expires_utc: string | null
}
```
Catalog in `app/quests.py`: daily (walk 2 km; hold a pace ≥ X for 10 min; complete 1 challenge), weekly
(5 km on 3 days; 15 km; open 5 packs; reach a milestone), `story` (derived from the journey: "reach <next milestone>",
reward = pack(s)). Progress is **derived** from existing tables; only the claim is stored (`quest_claims`).
`POST /api/me/quests/{id}/claim` → `{granted: PackGrant[], essence: number}`.

## 6. Leaderboard / race

- `GET /api/leaderboard?journey_id=&period=week|month|all` (default: the user's theme, `week`) →
  ```ts
  { journey_id: string; period: string; me_rank: number | null; total: number
    rows: { rank: number; profile: PublicProfile; distance_m: number; delta_rank: number; is_me: boolean;
            gap_to_next_m: number | null }[] }
  ```
  `distance_m` = credited distance over the period for this theme. At most 100 rows.
- `GET /api/users/{id}/profile` → `PublicProfile` (+ `recent_rares: CardDef[]`: their 5 best cards).
- `GET /api/live` → players currently walking: `{profile: PublicProfile, speed_kmh, session_distance_m}[]`.
- The server computes overtakes on every distance credit; on an overtake:
  a `rank_overtake` notification for both players + a `rank/overtake` grant.
- End of week (Monday 00:00 `WALKHOME_TZ`): the podium is settled lazily (on the first call after the rollover
  + at startup) → packs + a `weekly_podium` notification.

## 7. `/api/me/*` routes

| method & path | purpose |
|---|---|
| `GET /me` | `Me` |
| `PATCH /me` | `{display_name?, avatar?, color?, daily_goal_m?, journey_id?, units?}` (switching theme is allowed; progress is per theme) |
| `POST /me/password` | `{old, new}` |
| `GET /me/state` | full private state (see section 8, `Snapshot`) |
| `GET /me/sessions?limit=` | my sessions |
| `PATCH/DELETE /me/sessions/{id}` | edit note / delete (only my own) |
| `POST /me/walk/start` `{journey_id?}` | takes the treadmill (409 `treadmill_busy` if someone else holds it) |
| `POST /me/walk/pause|resume` / `POST /me/walk/stop {note?}` | control of my session |
| `POST /me/walk/choice {event_id, option_id}` | answer to a story choice |
| `POST /me/sessions/manual {distance_m, minutes, note?, when_utc?}` | capped manual entry (section 4) |
| `GET /me/journal?limit=`, `GET /me/daily?days=`, `GET /me/streak` | private history |
| `GET /me/packs` | `{unopened: PackGrant[], opened_count: number, next_pack_in_m: number, pack_every_m: number}` |
| `POST /me/packs/{id}/open` | → `OpenResult {cards: {card: CardDef, is_new: boolean, count: number, essence_gained: number}[], pity: {...}, essence: number}` |
| `GET /me/collection` | `{theme, owned: {card_id: {count, first_utc}}, completion: {set_id: {owned, total}}, essence}` |
| `POST /me/craft {card_id}` | → `{card_id, essence}` |
| `GET /me/economy` | craft costs / essence / thresholds |
| `GET /me/quests`, `POST /me/quests/{id}/claim` | section 5 |
| `GET /me/notifications?limit=`, `POST /me/notifications/read {ids?|all}` | notification centre |
| `GET /me/push/vapid` → `{public_key|null}`; `POST /me/push/subscribe {endpoint,keys}`; `DELETE /me/push/subscribe` | Web Push |

Error responses: `{detail: string, code?: string}` with HTTP 400/401/403/404/409/429.

## 8. WebSocket `/ws`

Envelope: `{type, seq, server_time, data}`. One client = one user; the hub filters:

| type | audience | content |
|---|---|---|
| `snapshot` | me, on connect and on `"resync"` | `Snapshot` |
| `tick` | me only, **only while my session is active** (1 Hz) | lightweight `Snapshot` |
| `live` | everyone | `{walkers: {user_id, display_name, avatar, color, speed_kmh}[]}` (presence, 0.2 Hz; no private data) |
| `reward` | me | `{grants: PackGrant[], reason: string, title: string}` |
| `notify` | me | `Notification` |
| `rank` | me | `{journey_id, rank, previous_rank, overtaken_by?: PublicProfile, overtook?: PublicProfile}` |
| `event` | me | journey event crossed |
| `challenge` | me | challenge result |

```ts
interface Snapshot {   // GET /me/state, ws snapshot, tick
  me: Me
  journey_id: string
  units: "km" | "mi"
  link: { state: "live"|"stale"|"disconnected"; detail: string; source: string }
  treadmill: { busy: boolean; walker: PublicProfile | null }   // is the treadmill taken, and by whom
  session: SessionSnap | null          // only my own
  subject: Subject                      // my progress
  packs: { unopened: number; next_pack_in_m: number; pack_every_m: number }
  rank: { week: number | null; all: number | null; total: number }
  unread_notifications: number
}
interface Notification { id: number; kind: "pack"|"rank_overtake"|"weekly_podium"|"streak_risk"|"quest"|"milestone"|"system"
  title: string; body: string; icon: string; created_utc: string; read: boolean; data?: Record<string, unknown> }
```

## 9. Web Push
VAPID: keys generated on first start in `data/vapid.json` (`pywebpush` library, optional dependency; when missing → `supported:false`).
Triggers: being overtaken, pack earned, streak at risk (tick job at 19:00 `WALKHOME_TZ` if 0 m today and streak ≥ 2),
weekly podium. At most 6 pushes/day/user. The service worker (`frontend/public/sw.js`) shows the notification and opens the app on `data.url`.

## 10. Database (v1 → v2 migration, lossless)

`SCHEMA_VERSION = 2`. Existing v1 `users` become accounts with `username` = slug of `display_name`,
`password_hash = NULL` ("claimable" account: first sign-in through `POST /api/auth/claim {username, password}` while the hash is NULL).
New tables: `auth_tokens`, `pack_grants`, `collection`, `wallet`, `pity`, `quest_claims`, `notifications`,
`push_subscriptions`, `rank_snapshots`, `weekly_awards`. Columns added to `users`: `username`, `password_hash`, `is_admin`,
`units`, `last_seen_utc`. `parties/party_members` are dropped (replaced by the leaderboard).

## 11. Module boundaries

| Module | Owns |
|---|---|
| **backend** | `app/**`, `tests/**`, `requirements.txt`, `content/*.json` (`rewards` field), `deploy/**` |
| **assets** | `tools/build_cards_*.mjs`, `content/cards/*.json`, `frontend/public/cards/**` |
| **frontend shell** | `frontend/src/**` except `features/tcg/**`, `frontend/index.html`, `frontend/public/{sw.js,manifest.webmanifest,icons}` |
| **frontend TCG** | `frontend/src/features/tcg/**`, `frontend/src/shaders/**`, `frontend/public/fonts/**` |

The TCG module exports from `src/features/tcg/index.ts`:
`PacksView`, `CollectionView`, `HoloCard` (`{card: CardDef; size?; interactive?; owned?}`), `CardDetailDialog` (`{card, onClose}`),
`PackOpeningOverlay` (`{grant: PackGrant; onDone}`), `useCatalog()` (cache of the theme's `CardCatalog`) and the types
in `src/features/tcg/types.ts`. The shell owns `lib/api.ts` (fetch with cookie, `credentials:"include"`) and `lib/store.ts`.

## 12. Implementation details (backend)

Refinements over the initial spec, all implemented and tested:

- **Grant keys are prefixed with the theme** wherever the identifier is not unique across themes
  (event ids are shared by every pack built from the same structure): `distance` = `<theme>:<n>`,
  `milestone` = `<theme>:<event_id>`, `album` = `<theme>:<set>:<pct>`, podium = `<theme>:<YYYY-Www>:<place>`
  (+ suffix `#2`, `#3` for extra packs at the same place). `welcome` = `1` and `2`.
  Distance packs are counted **per theme** (the theme's `pack_every_m`, distance credited in that theme).
- **"Credited" distance** (packs, quests, streaks) = full treadmill session distance + capped manual entries
  (`manual_reward_cap_m` = 5,000 m/day; an entry with an implied speed > 12 km/h or no duration is worth only 400 m).
  The **leaderboard** uses raw session distance (manual entries included, no handicap); **progress** applies the handicap.
- **Streaks**: a day counts when it holds ≥ 100 m of credited distance; one grace day is tolerated. The `daily` pack
  is only evaluated for **today** (a backdated session does not earn a daily pack): ≥ 1,000 m.
- **Overtakes**: detected by comparing the current weekly ranking with the last snapshot (`rank_snapshots`,
  taken when a walk starts / before a manual entry). The overtaken player must have ≥ 1,000 m this week.
  At most 3 `overtake` packs per day; notifications are not capped. Weekly podium: ≥ 1,000 m required.
- **`POST /me/packs/{id}/open`** also returns `{pack_id, theme, granted: PackGrant[]}` (album packs unlocked).
  `POST /me/craft` returns `{card_id, card, cost, essence, granted}`.
- **`POST /me/quests/{id}/claim`** → `{granted, essence, essence_gained}`: `essence` = wallet **balance**.
  Quest ids: `d_walk_2km`, `d_pace`, `d_challenge`, `w_5km_x3`, `w_15km`, `w_open_5`, `w_milestone`,
  `story:<theme>:<event_id>` (next unclaimed milestone). `d_pace`: 10 min in one go at ≥ 4.5 km/h (treadmill session).
- **`GET /me/collection?theme=`** (default: active theme). `GET /me/packs.unopened` lists packs from every theme.
- **WS**: the `challenge` message carries `phase: "started"|"finished"` (`started` → `{phase, challenge}`; `finished` →
  `{phase, title, icon, succeeded, text, held_s, duration_s}`). After any change to the walk state
  (start/pause/resume/stop/choice) the owner receives a `snapshot`; everyone receives a `live`.
  On connect: `snapshot` then `live`. The full `snapshot` (connect, `resync`, `GET /me/state`) also contains `recent_events`.
- **A WS client never receives** another user's `tick`/`snapshot`/`reward`/`notify`/`rank`/`event`/`challenge`.
  `live` only contains `{user_id, display_name, avatar, color, speed_kmh}`.
- **Auth**: the token is never returned in a JSON body (`wh_session` cookie only; a non-browser client
  reads `Set-Cookie` and then uses `Authorization: Bearer`). `claim`: if no admin exists yet, the claimed account
  becomes admin (same for `register`: "first account while no admin exists"). `logout` is public and idempotent.
  Changing the password signs out the other devices. `/api/journeys*` requires a session (the public list is `/api/themes`).
- **Accounts**: `username` unique case-insensitively; `display_name` (unique, inherited from v1) equals `username` at sign-up.
- **Extra routes** (admin only): `GET /api/admin/users`, `PATCH /api/admin/users/{id}` `{handicap?, archived?, is_admin?, daily_goal_m?}`,
  `DELETE /api/admin/users/{id}`, `POST /api/admin/adjustments {user_id, delta_m, reason?, journey_id?}`.
  The handicap can no longer be changed by the user. `PATCH /me/sessions/{id}` only accepts `{note}`.
- **`GET /api/themes`**: list of `{id, name, subtitle, lang, total_m, total_mi, …, card_count, has_catalog, pack_every_m}`;
  `GET /api/themes/{id}/cards` → 404 `catalog_unavailable` if `content/cards/<id>.json` does not exist (drawing from that theme is then disabled).
- **`GET /api/me/economy`**: `{dup_essence, craft_cost (secret = null), pack_every_m{theme}, manual_reward_cap_m, streak_tiers, album_tiers, podium_packs, welcome_packs}`.
- **No theme switch** during a walk (409 `walk_in_progress`). `POST /me/walk/start {journey_id}` also switches the active theme.
- **Error codes**: `unauthenticated`, `invalid_credentials`, `claim_required`, `not_claimable`, `rate_limited` (+ `Retry-After`),
  `username_taken`, `bad_username`, `weak_password`, `invite_required`, `registration_closed`, `treadmill_busy`, `already_walking`,
  `no_walk`, `not_your_walk`, `walk_in_progress`, `unknown_theme`, `catalog_unavailable`, `pack_not_found`, `pack_already_opened`,
  `card_not_found`, `already_owned`, `not_craftable`, `not_enough_essence`, `quest_not_found`, `quest_not_complete`, `quest_already_claimed`,
  `display_name_taken`, `bad_period`, `bad_endpoint`, `push_unsupported`, `admin_only`, `dev_disabled`.
- **Dev**: `POST /api/dev/sim` requires a session and (`WALKHOME_DEV` enabled, the default, or admin). `tools/seed_demo.py` creates 6 demo players.

## 13. Frontend notes

- The TCG module uses its own adapter `features/tcg/net.ts` (fetch + cookie) instead of `@/lib/api` (same `request(path,{method,body})` signature).
- The detail/craft view expects `GET /me/economy.craft_cost` (secret = null); falls back to 4 × the duplicate value.
- A pack's dressing = `catalog.sets[grant.id % n]` of the PACK's theme (the contract does not attach a set to a grant). `pack.webp` is drawn "contain" on a dark background.
- There is no API for the history of opened packs: the Packs view shows a counter + reward sources (static).
- `GET /api/themes` does not return a palette: the frontend derives a stable hue from the id (`fallbackPalette`). In game, the theme comes from the current biome.
- `LeaderRow.delta_rank` is read as **positive = places gained**.
- `/api/journeys/{id}` (session required) is loaded at sign-in and on every `journey_id` change.
- `POST /me/walk/stop`: the summary is computed from the last telemetry received (the response is not used).
- A WS `challenge` with `phase:"started"` is ignored (the short-lived state arrives through `session.challenge` in the tick).
- Mock mode: `src/lib/mock/` (separate chunk, never loaded without `?mock`). UI chrome strings (nav, auth, actions) go through `lib/i18n.ts`.
