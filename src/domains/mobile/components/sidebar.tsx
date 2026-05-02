import { FolderOpen, Menu, MessageSquarePlus, PanelsTopLeft, Settings2, Sparkles } from "lucide-react"

import { mobileController, mobileSelectors, patchState } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { Input } from "@/common/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/common/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/common/ui/sheet"
import { ScrollArea } from "@/common/ui/scroll-area"
import { cn } from "@/common/lib/utils"
import { useFilteredThreads } from "@/common/hooks/use-filtered-threads"

function startNewThread(state: Record<string, any>) {
  patchState({
    thread: null,
    selectedThread: null,
    activeTab: "chat",
    screen: "workspace",
    attachments: [],
    composerMentions: [],
    draftText: "",
    sidebarOpen: window.matchMedia("(min-width: 1024px)").matches,
  })
}

function closeSidebar() {
  patchState({ sidebarOpen: false })
}

function openSettings() {
  void mobileController.loadSettings()
  patchState({ sidebarOpen: false })
}

function toggleTab(tab: "chat" | "changes") {
  patchState({ activeTab: tab, screen: "workspace", sidebarOpen: false })
}

function SidebarBody({ state }: { state: Record<string, any> }) {
  const threads = useFilteredThreads(state)
  const changesCount = state.changes?.summary?.filesChanged || 0

  return (
    <div className="flex h-full flex-col bg-[var(--sidebar-bg)] text-[var(--ink)]">
      {/* Brand header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
            <Sparkles className="size-3.5" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[var(--ink-strong)]">Codex</span>
          <span className="rounded-full border border-[var(--hairline)] bg-[var(--canvas-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--muted-text)]">CLI</span>
        </div>
        <Button variant="ghost" size="icon-sm" className="lg:hidden rounded-md hover:bg-[var(--row-hover)]" onClick={closeSidebar} aria-label="Close sidebar">
          <PanelsTopLeft className="size-4 text-[var(--muted-text)]" />
        </Button>
      </div>

      {/* New session quick action */}
      <Button
        variant="ghost"
        onClick={() => startNewThread(state)}
        className="mx-2 mb-1 mt-0.5 h-9 justify-start gap-2 rounded-md text-[13.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]"
      >
        <MessageSquarePlus className="size-4" />
        <span>New session</span>
      </Button>

      {/* Project select */}
      <div className="px-3">
        <Select
          value={state.selectedProject?.cwd || ""}
          onValueChange={(cwd) => {
            const project = (state.projects || []).find((candidate: any) => candidate.cwd === cwd)
            if (project) void mobileController.loadThreads(project, { selectFirst: true })
          }}
        >
          <SelectTrigger className="h-9 w-full justify-between gap-2 rounded-md border-0 bg-transparent px-2 text-[13.5px] text-[var(--ink)] shadow-none hover:bg-[var(--row-hover)] focus:bg-[var(--row-hover)] focus:ring-0">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen className="size-4 shrink-0 text-[var(--muted-text)]" />
              <SelectValue placeholder="프로젝트 선택" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {(state.projects || []).map((project: any) => (
              <SelectItem key={project.cwd} value={project.cwd}>{project.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-0.5 px-2 text-[11px] text-[var(--muted-text-soft)]">
          {state.projects.length} projects
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-3">
        <Input
          value={state.threadSearch || ""}
          onChange={(event) => patchState({ threadSearch: event.target.value })}
          placeholder="Search chats"
          className="h-9 rounded-md border-[var(--hairline)] bg-[var(--surface-warm)] px-3 text-[13px] placeholder:text-[var(--muted-text-soft)] focus-visible:border-[var(--primary)]/40 focus-visible:ring-1 focus-visible:ring-[var(--primary)]/20"
        />
      </div>

      {/* Recents label */}
      <div className="flex items-center justify-between px-4 pt-2 pb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-text)]">
        <span>Recents</span>
        <span className="tabular-nums text-[10px]">{threads.length}</span>
      </div>

      {/* Thread list */}
      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        <div className="space-y-0.5 px-1">
          {state.threadsLoading ? Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="rounded-md px-2.5 py-2">
              <div className="h-3 w-3/4 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
              <div className="mt-2 h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
            </div>
          )) : null}

          {!state.threadsLoading && !threads.length ? (
            <div className="mx-1 rounded-md border border-dashed border-[var(--hairline)] bg-transparent px-3 py-6 text-center text-xs text-[var(--muted-text)]">
              {state.threadSearch ? "검색 결과가 없습니다." : "이 프로젝트에 아직 대화가 없습니다."}
            </div>
          ) : null}

          {threads.map((thread: any) => {
            const active = thread.id === state.thread?.id
            const tone = mobileSelectors.threadStatusTone(mobileSelectors.formatThreadStatus(thread.status))
            return (
              <button
                key={thread.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => {
                  void mobileController.loadThread(thread.id)
                  closeSidebar()
                }}
                className={cn(
                  "group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  active ? "bg-[var(--row-selected)]" : "hover:bg-[var(--row-hover)]"
                )}
              >
                <span className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  tone === "danger" && "bg-[var(--status-error)]",
                  tone === "done" && "bg-[var(--status-done)]",
                  tone === "busy" && "animate-pulse bg-[var(--status-busy)]",
                  tone === "pending" && "bg-[var(--status-pending)]",
                  tone === "neutral" && "bg-[var(--hairline-strong)]"
                )} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-[var(--ink)]">
                    {thread.name || thread.title || thread.preview || "Untitled"}
                  </span>
                  <span className="mt-1 block text-[11px] text-[var(--muted-text)]">
                    {mobileSelectors.formatDate(thread.updatedAt || thread.createdAt)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-[var(--hairline-soft)] px-2 py-2 space-y-0.5">
        <Button variant="ghost" disabled={!state.thread} onClick={() => toggleTab("chat")}
          className={cn(
            "h-9 w-full justify-start gap-2 rounded-md text-[13.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]",
            state.activeTab === "chat" && state.thread && "bg-[var(--row-selected)]"
          )}>
          <FolderOpen className="size-4 text-[var(--muted-text)]" /> Chat
        </Button>
        <Button variant="ghost" disabled={!state.thread} onClick={() => toggleTab("changes")}
          className={cn(
            "h-9 w-full justify-start gap-2 rounded-md text-[13.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]",
            state.activeTab === "changes" && state.thread && "bg-[var(--row-selected)]"
          )}>
          <Sparkles className="size-4 text-[var(--muted-text)]" /> Changes
          {changesCount ? (
            <span className="ml-auto rounded-full bg-[var(--canvas-soft)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--ink)]">{changesCount}</span>
          ) : null}
        </Button>
        <Button variant="ghost" onClick={openSettings}
          className="h-9 w-full justify-start gap-2 rounded-md text-[13.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]">
          <Settings2 className="size-4 text-[var(--muted-text)]" /> Settings
        </Button>
      </div>
    </div>
  )
}

export function Sidebar({ state, desktopCollapsed = false }: { state: Record<string, any>; desktopCollapsed?: boolean }) {
  return (
    <>
      <div
        className={cn(
          "border-r border-[var(--hairline-soft)] bg-[var(--sidebar-bg)] lg:h-full lg:w-[320px] lg:flex-col",
          desktopCollapsed ? "hidden" : "hidden lg:flex",
        )}
      >
        <SidebarBody state={state} />
      </div>
      <Sheet open={state.sidebarOpen && !window.matchMedia("(min-width: 1024px)").matches} onOpenChange={(open) => patchState({ sidebarOpen: open })}>
        <SheetContent side="left" className="w-[84vw] max-w-[340px] border-r border-[var(--hairline-soft)] bg-[var(--sidebar-bg)] p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Chats navigation</SheetTitle>
            <SheetDescription>프로젝트와 대화를 탐색합니다.</SheetDescription>
          </SheetHeader>
          <SidebarBody state={state} />
        </SheetContent>
      </Sheet>
    </>
  )
}

export function SidebarToggle() {
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" className="rounded-md hover:bg-[var(--row-hover)] lg:hidden" onClick={() => patchState((current) => ({ sidebarOpen: !current.sidebarOpen }))}>
      <Menu className="size-4" />
    </Button>
  )
}
