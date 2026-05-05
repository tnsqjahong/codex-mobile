import { useEffect, useState } from "react"

type Platform = "android-chrome" | "ios-safari" | "desktop" | "other"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const TEMPORARY_HOSTNAMES = [
  /\.trycloudflare\.com$/i,
  /\.ngrok\.app$/i,
  /\.ngrok-free\.app$/i,
  /\.loca\.lt$/i,
]

function isStableOrigin(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return false
  return !TEMPORARY_HOSTNAMES.some((pattern) => pattern.test(hostname))
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other"
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window)
  const isAndroid = /Android/.test(ua)
  if (isIOS) return "ios-safari"
  if (isAndroid) return "android-chrome"
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop"
  return "other"
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true
  return Boolean((navigator as unknown as { standalone?: boolean }).standalone)
}

export function usePwaInstall() {
  const [platform] = useState<Platform>(() => detectPlatform())
  const [stableOrigin] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isStableOrigin(window.location.hostname),
  )
  const [standalone, setStandalone] = useState<boolean>(() => isStandalone())
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    const installed = () => {
      setStandalone(true)
      setInstallEvent(null)
    }
    window.addEventListener("beforeinstallprompt", handler)
    window.addEventListener("appinstalled", installed)
    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.removeEventListener("appinstalled", installed)
    }
  }, [])

  const canInstall =
    !standalone &&
    stableOrigin &&
    (platform === "android-chrome" ? installEvent !== null : platform === "ios-safari")

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!installEvent) return "unavailable"
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    return choice.outcome
  }

  return { canInstall, platform, stableOrigin, standalone, promptInstall }
}
