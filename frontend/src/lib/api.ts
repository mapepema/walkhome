/** Thin fetch wrapper: session cookie, typed errors, global 401 handling. */

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

/** The store registers itself here so a 401 anywhere logs the user out. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn
}

export interface ApiOptions {
  method?: string
  body?: unknown
  /** Don't trigger the global logout on 401 (login form, boot probe). */
  silent401?: boolean
  signal?: AbortSignal
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError("Server unreachable", 0, "network")
  }
  if (!res.ok) {
    let detail = res.statusText
    let code: string | undefined
    try {
      const data = await res.json()
      if (typeof data.detail === "string") detail = data.detail
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) detail = data.detail[0].msg
      if (typeof data.code === "string") code = data.code
    } catch {
      /* keep statusText */
    }
    if (res.status === 401 && !opts.silent401) onUnauthorized?.()
    throw new ApiError(detail, res.status, code)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body ?? {} })
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body })
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" })

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
