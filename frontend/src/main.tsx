import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import App from "./App.tsx"

async function start() {
  const q = new URLSearchParams(location.search)
  if (q.has("mock")) {
    try {
      if (q.get("mock") === "0") sessionStorage.removeItem("wh-mock")
      else sessionStorage.setItem("wh-mock", "1")
    } catch {
      /* private mode */
    }
  }
  let mock = import.meta.env.VITE_MOCK === "1"
  try {
    mock ||= sessionStorage.getItem("wh-mock") === "1"
  } catch {
    mock ||= q.get("mock") === "1"
  }
  if (mock) (await import("./lib/mock")).installMock()

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  if ("serviceWorker" in navigator && !import.meta.env.DEV && !mock) {
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }
}
start()
