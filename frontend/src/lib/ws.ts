/** WebSocket lifecycle: auto-reconnect with backoff, seq filtering, resync.
 * The store owns one instance. A close with 4401 means "no session". */

export interface Envelope {
  type: string
  seq: number
  server_time?: string
  data: any
}

export interface WsHandlers {
  onOpen: () => void
  onClose: (code: number) => void
  onMessage: (env: Envelope) => void
  onUnauthorized: () => void
}

export class WalkSocket {
  private ws: WebSocket | null = null
  private seq = 0
  private retry = 0
  private timer: number | null = null
  private stopped = false

  private h: WsHandlers
  constructor(h: WsHandlers) {
    this.h = h
  }

  start() {
    this.stopped = false
    this.open()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }

  resync() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("resync")
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private open() {
    const proto = location.protocol === "https:" ? "wss" : "ws"
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.seq = 0
      this.h.onOpen()
    }
    ws.onclose = (ev) => {
      this.h.onClose(ev.code)
      if (this.stopped) return
      if (ev.code === 4401) {
        this.h.onUnauthorized()
        return
      }
      const delay = Math.min(15000, 1000 * 2 ** this.retry++)
      this.timer = window.setTimeout(() => this.open(), delay)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = (msg) => {
      let env: Envelope
      try {
        env = JSON.parse(msg.data)
      } catch {
        return
      }
      if (env.type !== "snapshot") {
        if (env.seq <= this.seq) return // stale / duplicate
        if (env.seq > this.seq + 8 && this.seq > 0) this.resync() // big gap
      }
      this.seq = Math.max(this.seq, env.seq)
      this.h.onMessage(env)
    }
  }
}
