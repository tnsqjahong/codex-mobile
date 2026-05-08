import { useCallback, useSyncExternalStore } from "react"

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  )
}
