import { api, del, post } from "./api"

export function pushCapable(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function enablePush(): Promise<void> {
  if (!pushCapable()) throw new Error("This browser does not support push notifications (on iPhone: add the app to your Home Screen first).")
  const perm = await Notification.requestPermission()
  if (perm !== "granted") throw new Error("Notifications were blocked in the browser.")
  const { public_key } = await api<{ public_key: string | null }>("/me/push/vapid")
  if (!public_key) throw new Error("Push notifications are not configured on the server.")
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(public_key) }))
  await post("/me/push/subscribe", sub.toJSON())
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    /* ignore */
  }
  await del("/me/push/subscribe")
}
