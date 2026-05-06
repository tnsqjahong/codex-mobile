import { useEffect } from "react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { useMobileRuntime } from "@/common/hooks/use-mobile-runtime"
import { useVisualViewport } from "@/common/hooks/use-visual-viewport"
import { TooltipProvider } from "@/common/ui/tooltip"
import { InstallPrompt } from "@/domains/mobile/components/install-prompt"
import { PairingView } from "@/domains/mobile/components/pairing-view"
import { SettingsPane } from "@/domains/mobile/components/settings-pane"
import { WorkspaceShell } from "@/domains/mobile/components/workspace-shell"

export default function App() {
  useVisualViewport()
  const state = useMobileRuntime()

  useEffect(() => {
    void mobileController.init()
  }, [])

  if (!state.token) {
    return (
      <>
        <PairingView state={state} />
        <InstallPrompt />
      </>
    )
  }

  return (
    <TooltipProvider>
      {state.screen === "settings" ? <SettingsPane state={state} /> : <WorkspaceShell state={state} />}
      <InstallPrompt />
    </TooltipProvider>
  )
}
