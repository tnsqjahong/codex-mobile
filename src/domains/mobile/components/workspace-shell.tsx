import { FolderGit2, FolderOpen, PanelLeft, PanelLeftOpen, Share2, Sparkles } from "lucide-react"

import { patchState } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
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
        "flex h-dvh overflow-hidden bg-[var(--canvas)] text-[var(--ink)] lg:grid lg:grid-rows-[100%]",
        desktopSidebarCollapsed
          ? "lg:grid-cols-[minmax(0,1fr)]"
          : "lg:grid-cols-[320px_minmax(0,1fr)]",
      )}
      style={{ height: "var(--app-height, 100dvh)", maxWidth: "var(--app-width, 100vw)" }}
    >
      <Sidebar state={state} desktopCollapsed={desktopSidebarCollapsed} />

      <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-[var(--hairline)] focus:bg-[var(--surface-warm)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--ink)]"
        >
          본문으로 바로가기
        </a>

        {/* Slim breadcrumb header */}
        <header className="sticky top-0 z-20 border-b border-[var(--hairline-soft)] bg-[var(--canvas)]">
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
              {changesCount ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 rounded-md px-2 text-[12.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]"
                  onClick={() => patchState({ activeTab: "changes" })}
                >
                  <FolderGit2 className="size-3.5 text-[var(--muted-text)]" />
                  <span className="tabular-nums">{changesCount}</span>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-md hover:bg-[var(--row-hover)]"
                aria-label="Share thread"
                onClick={() => void shareThread(state)}
                disabled={!state.thread}
              >
                <Share2 className="size-4 text-[var(--muted-text)]" />
              </Button>
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

        {/* Sticky tab strip (mobile only) */}
        <div className="sticky top-12 z-10 border-b border-[var(--hairline-soft)] bg-[var(--canvas)] lg:hidden">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-3 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchState({ activeTab: "chat" })}
              disabled={!state.thread}
              className={cn(
                "h-8 rounded-md px-2.5 text-[13px] font-medium",
                state.activeTab === "chat"
                  ? "bg-[var(--row-selected)] text-[var(--ink-strong)]"
                  : "text-[var(--muted-text)] hover:bg-[var(--row-hover)]",
              )}
            >
              Chat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => patchState({ activeTab: "changes" })}
              disabled={!state.thread}
              className={cn(
                "h-8 gap-1 rounded-md px-2.5 text-[13px] font-medium",
                state.activeTab === "changes"
                  ? "bg-[var(--row-selected)] text-[var(--ink-strong)]"
                  : "text-[var(--muted-text)] hover:bg-[var(--row-hover)]",
              )}
            >
              <Sparkles className="size-3.5" /> Changes
            </Button>
          </div>
        </div>

        <main id="main-content" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--canvas)]">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {state.activeTab === "changes" ? <ChangesPane state={state} /> : <ChatPane state={state} />}
          </div>
          {state.screen === "workspace" && state.activeTab === "chat" ? <Composer state={state} /> : null}
        </main>
      </div>
    </div>
  )
}
