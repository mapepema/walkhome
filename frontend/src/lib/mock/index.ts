/** `?mock=1` (or VITE_MOCK=1): replaces fetch + WebSocket with an in-browser
 * fake backend so the UI can be developed and screenshotted without a server.
 * `?mock=anon` starts logged out; `&busy=1` makes the treadmill busy. */
import { FakeWebSocket, MockServer } from "./server"
import { route } from "./routes"

export function installMock() {
  const srv = new MockServer()
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const u = new URL(url, location.origin)
    if (!u.pathname.startsWith("/api/")) return realFetch(input, init)
    const method = (init?.method ?? "GET").toUpperCase()
    let body: unknown = {}
    try { body = init?.body ? JSON.parse(String(init.body)) : {} } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 160))
    const { status, body: json } = route(srv, method, u.pathname.slice(4) + u.search, body)
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } })
  }
  const Native = window.WebSocket
  ;(window as any).WebSocket = class extends FakeWebSocket {
    constructor(url: string) {
      super(url, srv)
    }
    static OPEN = Native.OPEN
  }
  ;(window as any).__mock = srv.demo
  ;(window as any).__mockSrv = srv
  console.info("[walkhome] mock backend active")
}

