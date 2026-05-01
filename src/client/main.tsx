import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "@/app/App"
import "./index.css"

createRoot(document.querySelector("#app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
