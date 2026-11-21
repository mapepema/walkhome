/**
 * Network adapter for the TCG module: `fetch` with the session cookie.
 * In `?mock=1` mode the app-wide mock (`src/lib/mock`) intercepts `fetch`,
 * so nothing special is needed here.
 */
export class NetError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function request<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? "GET"
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new NetError("Network unavailable", 0, "network")
  }
  if (!res.ok) {
    let detail = res.statusText
    let code: string | undefined
    try {
      const data = await res.json()
      if (typeof data.detail === "string") detail = data.detail
      if (typeof data.code === "string") code = data.code
    } catch {
      /* statusText */
    }
    throw new NetError(detail, res.status, code)
  }
  return (await res.json()) as T
}
