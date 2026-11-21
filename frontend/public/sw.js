/* Walkhome service worker.
 * - app shell precached; navigation: network first, cached shell offline
 * - /api: network first (GET only, small cache as offline fallback), never /ws
 * - hashed assets, fonts, models, card images: cache first, with a size guard
 * - Web Push: show + open the app on data.url */
const VERSION = "v3"
const SHELL = `walkhome-shell-${VERSION}`
const ASSETS = `walkhome-assets-${VERSION}`
const API = `walkhome-api-${VERSION}`
const MAX_ASSET_ENTRIES = 400
const MAX_BODY_BYTES = 6 * 1024 * 1024

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS, API].includes(k)).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

async function trim(cacheName, max) {
  const c = await caches.open(cacheName)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i])
}

async function put(cacheName, req, res, max) {
  const len = Number(res.headers.get("content-length") || 0)
  if (!res.ok || len > MAX_BODY_BYTES) return
  const c = await caches.open(cacheName)
  await c.put(req, res)
  if (max) trim(cacheName, max)
}

self.addEventListener("fetch", (e) => {
  const req = e.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== location.origin || url.pathname === "/ws") return

  if (url.pathname.startsWith("/api/")) {
    // private data: never keep it past a logout-sized window; used only as offline fallback
    if (/\/api\/(auth|me\/push)/.test(url.pathname)) return
    e.respondWith(
      fetch(req)
        .then((res) => { put(API, req, res.clone(), 60); return res })
        .catch(() => caches.match(req).then((hit) => hit || new Response(JSON.stringify({ detail: "Offline" }), { status: 503, headers: { "Content-Type": "application/json" } }))),
    )
    return
  }

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { put(SHELL, "/", res.clone()); return res }).catch(() => caches.match("/")))
    return
  }

  // static: hashed bundles, fonts, 3D models, card art and maps
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => { put(ASSETS, req, res.clone(), MAX_ASSET_ENTRIES); return res }),
    ),
  )
})

self.addEventListener("push", (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: "Walkhome", body: e.data ? e.data.text() : "" } }
  e.waitUntil(
    self.registration.showNotification(d.title || "Walkhome", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: d.tag || d.kind || undefined,
      renotify: !!d.tag,
      data: { url: (d.data && d.data.url) || d.url || "/#/camp" },
    }),
  )
})

self.addEventListener("notificationclick", (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || "/#/camp"
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          if (c.navigate) c.navigate(url).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
