import { FolderOpen, MessageSquare, MoreHorizontal, PanelLeft, PanelLeftOpen, RefreshCw, Share2, Sparkles } from "lucide-react"

import { mobileController, patchState } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/common/ui/dropdown-menu"
import { cn } from "@/common/lib/utils"
import { useWorkspaceHeader } from "@/common/hooks/use-workspace-header"
import { Sidebar, SidebarToggle } from "@/domains/mobile/components/sidebar"
import { ChatPane, ChangesPane } from "@/domains/mobile/components/chat-pane"
import { Composer } from "@/domains/mobile/components/composer"

async function shareThread(state: Record<string, any>) {
  const title = state.thread?.name || state.thread?.preview || "Codex thread"
  const url = window.location.href
  const text = `${title}\n${url}`
  try {
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text, url })
      return
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    }
  } catch {
    // user cancelled or share not permitted
  }
}

function toggleDesktopSidebar() {
  patchState((current) => ({
    desktopSidebarCollapsed: !current.desktopSidebarCollapsed,
  }))
}

export function WorkspaceShell({ state }: { state: Record<string, any> }) {
  const { title, projectName, changesCount } = useWorkspaceHeader(state)
  const desktopSidebarCollapsed = Boolean(state.desktopSidebarCollapsed)

  return (
    <div
      className={cn(
        "codex-workspace-shell flex h-dvh overflow-hidden bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-rows-[100%]",
        desktopSidebarCollapsed
          ? "lg:grid-cols-[minmax(0,1fr)]"
          : "lg:grid-cols-[320px_minmax(0,1fr)]",
      )}
      style={{ height: "var(--app-viewport-height)", maxWidth: "100vw" }}
    >
      <Sidebar state={state} desktopCollapsed={desktopSidebarCollapsed} />

      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-[var(--hairline)] focus:bg-[var(--surface-warm)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--ink)]"
        >
          본문으로 바로가기
        </a>

        {/* Slim breadcrumb header — pt = iOS notch/status bar safe area */}
        <header
          className="codex-topbar sticky top-0 z-20 border-b border-[var(--hairline-soft)] bg-[var(--canvas)]"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-2 px-3">
            <SidebarToggle />
            {desktopSidebarCollapsed ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden rounded-md hover:bg-[var(--row-hover)] lg:inline-flex"
                aria-label="Show sidebar"
                onClick={toggleDesktopSidebar}
              >
                <PanelLeftOpen className="size-4 text-[var(--muted-text)]" />
              </Button>
            ) : null}
            <div
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left"
              title={[projectName, title].filter(Boolean).join(" / ")}
            >
              <FolderOpen className="size-4 shrink-0 text-[var(--muted-text)]" />
              {projectName ? (
                <span className="hidden truncate text-[13px] text-[var(--ink-strong)] sm:inline">{projectName}</span>
              ) : null}
              {projectName && title ? (
                <span className="hidden text-[13px] text-[var(--muted-text)] sm:inline">/</span>
              ) : null}
              <span className="truncate text-[13px] font-medium text-[var(--ink-strong)]">{title}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="rounded-md hover:bg-[var(--row-hover)]"
                    aria-label="Thread actions"
                    title="Thread actions"
                  >
                    <MoreHorizontal className="size-4 text-[var(--muted-text)]" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="w-56 rounded-2xl border-[var(--hairline-soft)] bg-[color-mix(in_srgb,var(--surface-warm)_92%,transparent)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-xl"
                >
                  <DropdownMenuLabel>View</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={state.activeTab || "chat"}
                    onValueChange={(value) => patchState({ activeTab: value })}
                  >
                    <DropdownMenuRadioItem value="chat" disabled={!state.thread}>
                      <MessageSquare className="size-4" />
                      <span>Chat</span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="changes" disabled={!state.thread}>
                      <Sparkles className="size-4" />
                      <span className="min-w-0 flex-1">Changes</span>
                      {changesCount ? (
                        <span className="ml-auto text-[11px] tabular-nums text-[var(--muted-text)]">{changesCount}</span>
                      ) : null}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!state.thread || state.realtimeRefreshing}
                    onSelect={() => void mobileController.refreshRealtime()}
                  >
                    <RefreshCw className={cn("size-4", state.realtimeRefreshing && "animate-spin")} />
                    <span>Refresh chat</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!state.thread}
                    onSelect={() => void shareThread(state)}
                  >
                    <Share2 className="size-4" />
                    <span>Share thread</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden rounded-md hover:bg-[var(--row-hover)] lg:inline-flex"
                aria-label={desktopSidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
                onClick={toggleDesktopSidebar}
              >
                <PanelLeft className="size-4 text-[var(--muted-text)]" />
              </Button>
            </div>
          </div>
        </header>

        <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--canvas)]">
          <div key={state.activeTab || "chat"} className="codex-pane-enter min-h-0 min-w-0 flex-1 overflow-hidden">
            {state.activeTab === "changes" ? <ChangesPane state={state} /> : <ChatPane state={state} />}
          </div>
          {state.screen === "workspace" && state.activeTab === "chat" ? <Composer state={state} /> : null}
        </main>
      </div>
    </div>
  )
}
