import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"

import App from "@/app/App"
import "./index.css"

registerSW({ immediate: true })

createRoot(document.querySelector("#app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
