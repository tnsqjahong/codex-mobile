import { useEffect } from "react"

const KEYBOARD_INSET_THRESHOLD = 120
let largestViewportHeight = 0

function syncVisualViewport() {
  const root = document.documentElement
  const viewport = window.visualViewport
  const height = viewport?.height ?? window.innerHeight
  const offsetTop = viewport?.offsetTop ?? 0
  largestViewportHeight = Math.max(largestViewportHeight, window.innerHeight, height + offsetTop)
  const bottomInset = Math.max(0, largestViewportHeight - height - offsetTop)
  const keyboardOpen = bottomInset > KEYBOARD_INSET_THRESHOLD
  const visualSafeBottom = keyboardOpen ? 0 : bottomInset
  const viewportBottom = keyboardOpen ? height + offsetTop : height

  root.dataset.keyboardOpen = keyboardOpen ? "true" : "false"
  root.style.setProperty("--app-visual-safe-bottom", `${Math.ceil(visualSafeBottom)}px`)
  root.style.setProperty("--app-visual-viewport-height", `${Math.ceil(viewportBottom)}px`)
}

export function useVisualViewport() {
  useEffect(() => {
    let frame = 0

    const scheduleSync = () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        syncVisualViewport()
      })
    }

    syncVisualViewport()

    const viewport = window.visualViewport
    viewport?.addEventListener("resize", scheduleSync)
    viewport?.addEventListener("scroll", scheduleSync)
    const resetBaseline = () => {
      largestViewportHeight = 0
      scheduleSync()
    }

    window.addEventListener("resize", scheduleSync)
    window.addEventListener("orientationchange", resetBaseline)
    window.addEventListener("pageshow", scheduleSync)
    document.addEventListener("visibilitychange", scheduleSync)

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      viewport?.removeEventListener("resize", scheduleSync)
      viewport?.removeEventListener("scroll", scheduleSync)
      window.removeEventListener("resize", scheduleSync)
      window.removeEventListener("orientationchange", resetBaseline)
      window.removeEventListener("pageshow", scheduleSync)
      document.removeEventListener("visibilitychange", scheduleSync)
    }
  }, [])
}
