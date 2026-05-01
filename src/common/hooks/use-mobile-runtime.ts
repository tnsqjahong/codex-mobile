import { useSyncExternalStore } from "react"

import { getSnapshot, state, subscribe } from "@/domains/mobile/runtime/controller"

export function useMobileRuntime() {
  useSyncExternalStore(subscribe, () => getSnapshot().version)
  return state
}
