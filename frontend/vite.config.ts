import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import glsl from "vite-plugin-glsl"

const API = process.env.WALKHOME_API ?? "http://localhost:8090"

export default defineConfig({
  plugins: [react(), tailwindcss(), glsl()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": API,
      "/ws": { target: API.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 900 },
})
