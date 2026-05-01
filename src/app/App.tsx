import { useEffect } from "react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { useMobileRuntime } from "@/common/hooks/use-mobile-runtime"
import { TooltipProvider } from "@/common/ui/tooltip"
import { PairingView } from "@/domains/mobile/components/pairing-view"
import { SettingsPane } from "@/domains/mobile/components/settings-pane"
import { WorkspaceShell } from "@/domains/mobile/components/workspace-shell"

export default function App() {
  const state = useMobileRuntime()

  useEffect(() => {
    void mobileController.init()
  }, [])

  if (!state.token) return <PairingView state={state} />

  return (
    <TooltipProvider>
      {state.screen === "settings" ? <SettingsPane state={state} /> : <WorkspaceShell state={state} />}
    </TooltipProvider>
  )
}
