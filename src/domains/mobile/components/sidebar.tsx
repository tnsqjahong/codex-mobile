import { memo, useCallback, useMemo, useState, type MouseEvent } from "react"
import { Check, FolderOpen, Menu, MessageSquarePlus, PanelsTopLeft, Settings2, Sparkles, Trash2, X } from "lucide-react"

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
import { useMediaQuery } from "@/common/hooks/use-media-query"
import { useProgressiveWindow } from "@/common/hooks/use-progressive-window"

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

type SidebarThreadRowProps = {
  active: boolean
  discardMode: boolean
  onArchiveThread: (threadId: any) => void
  onLoadThread: (threadId: any) => void
  onToggleSelection: (threadId: string) => void
  selected: boolean
  thread: any
}

function SidebarThreadRowImpl({
  active,
  discardMode,
  onArchiveThread,
  onLoadThread,
  onToggleSelection,
  selected,
  thread,
}: SidebarThreadRowProps) {
  const tone = mobileSelectors.threadStatusTone(mobileSelectors.formatThreadStatus(thread.status))
  const threadId = String(thread.id || "")
  const updatedAt = mobileSelectors.formatDate(thread.updatedAt || thread.createdAt)
  const title = thread.name || thread.title || thread.preview || "Untitled"
  const toggleSelection = useCallback(() => {
    onToggleSelection(threadId)
  }, [onToggleSelection, threadId])
  const openThread = useCallback(() => {
    if (discardMode) {
      onToggleSelection(threadId)
      return
    }
    onLoadThread(thread.id)
  }, [discardMode, onLoadThread, onToggleSelection, thread.id, threadId])
  const archiveThread = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onArchiveThread(thread.id)
  }, [onArchiveThread, thread.id])

  return (
    <div className={cn("group/thread relative flex items-start rounded-md", discardMode && selected && "bg-[var(--row-selected)]")}>
      {discardMode ? (
        <button
          type="button"
          aria-label={selected ? "Unselect session" : "Select session"}
          aria-pressed={selected}
          onClick={toggleSelection}
          className="grid h-full min-h-[3.25rem] w-10 shrink-0 place-items-center rounded-l-md text-[var(--muted-text)]"
        >
          <span className={cn(
            "grid size-5 place-items-center rounded-full border transition-colors",
            selected
              ? "border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_22%,transparent)] text-[var(--status-error)]"
              : "border-[var(--hairline-strong)] bg-transparent",
          )}>
            {selected ? <Check className="size-3.5" /> : null}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        aria-current={active ? "true" : undefined}
        onClick={openThread}
        className={cn(
          "codex-windowed-row flex w-full min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
          discardMode ? "pl-0 pr-2" : "pr-9",
          active && !discardMode ? "bg-[var(--row-selected)]" : "hover:bg-[var(--row-hover)]"
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
            {title}
          </span>
          <span className="mt-1 block text-[11px] text-[var(--muted-text)]">
            {updatedAt}
          </span>
        </span>
      </button>
      {!discardMode ? (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-md text-[var(--muted-text)] opacity-0 transition-[opacity,background-color,color] hover:bg-[var(--row-hover)] hover:text-[var(--ink-strong)] focus-visible:opacity-100 group-hover/thread:opacity-100"
          aria-label="Remove session from recents"
          onClick={archiveThread}
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

const SidebarThreadRow = memo(
  SidebarThreadRowImpl,
  (prev, next) =>
    prev.active === next.active &&
    prev.discardMode === next.discardMode &&
    prev.onArchiveThread === next.onArchiveThread &&
    prev.onLoadThread === next.onLoadThread &&
    prev.onToggleSelection === next.onToggleSelection &&
    prev.selected === next.selected &&
    prev.thread === next.thread,
)

function SidebarBody({ state }: { state: Record<string, any> }) {
  const threads = useFilteredThreads(state)
  const [discardMode, setDiscardMode] = useState(false)
  const [selectedDiscardIds, setSelectedDiscardIds] = useState<Set<string>>(() => new Set())
  const [discardConfirming, setDiscardConfirming] = useState(false)
  const threadWindow = useProgressiveWindow(threads, {
    initialCount: 60,
    step: 40,
    direction: "head",
    resetKey: `${state.selectedProject?.cwd || ""}:${state.threadSearch || ""}`,
  })
  const selectableThreadIds = useMemo(
    () => threads.map((thread: any) => String(thread.id || "")).filter(Boolean),
    [threads],
  )
  const selectedThreadIds = useMemo(
    () => selectableThreadIds.filter((id) => selectedDiscardIds.has(id)),
    [selectableThreadIds, selectedDiscardIds],
  )
  const allSelected = selectableThreadIds.length > 0 && selectedThreadIds.length === selectableThreadIds.length

  const toggleDiscardMode = useCallback(() => {
    setDiscardMode(true)
    setSelectedDiscardIds(new Set())
    setDiscardConfirming(false)
  }, [])

  const cancelDiscardMode = useCallback(() => {
    setDiscardMode(false)
    setSelectedDiscardIds(new Set())
    setDiscardConfirming(false)
  }, [])

  const toggleDiscardSelection = useCallback((threadId: string) => {
    setDiscardConfirming(false)
    setSelectedDiscardIds((current) => {
      const next = new Set(current)
      if (next.has(threadId)) next.delete(threadId)
      else next.add(threadId)
      return next
    })
  }, [])

  const toggleAllDiscardSelection = useCallback(() => {
    setDiscardConfirming(false)
    setSelectedDiscardIds((current) => {
      const next = new Set(current)
      if (allSelected) selectableThreadIds.forEach((id) => next.delete(id))
      else selectableThreadIds.forEach((id) => next.add(id))
      return next
    })
  }, [allSelected, selectableThreadIds])

  const discardSelectedThreads = useCallback(async () => {
    if (!selectedThreadIds.length) return
    const result = await mobileController.archiveThreads(selectedThreadIds, { confirm: false })
    if (!result) return
    const failed = new Set(result.failedIds || [])
    setSelectedDiscardIds(failed)
    setDiscardConfirming(false)
    if (!failed.size) setDiscardMode(false)
  }, [selectedThreadIds])
  const loadThread = useCallback((threadId: any) => {
    void mobileController.loadThread(threadId)
    closeSidebar()
  }, [])
  const archiveThread = useCallback((threadId: any) => {
    void mobileController.archiveThread(threadId)
  }, [])

  return (
    <div
      className="codex-sidebar-enter flex h-full flex-col bg-[var(--sidebar-bg)] text-[var(--ink)]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "var(--app-effective-safe-bottom)",
      }}
    >
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

      {/* Recents controls */}
      <div className="px-4 pt-2 pb-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted-text)]">
          <span>Recents</span>
          {discardMode ? (
            <span className="tabular-nums text-[10px] normal-case tracking-normal">
              {selectedThreadIds.length}/{threads.length} selected
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums text-[10px]">{threads.length}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={!threads.length}
                onClick={toggleDiscardMode}
                className="h-6 rounded-md px-1.5 text-[11px] font-medium normal-case tracking-normal text-[var(--muted-text)] hover:text-[var(--ink-strong)]"
              >
                <Trash2 className="size-3" />
                버리기
              </Button>
            </div>
          )}
        </div>
        {discardMode ? (
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!threads.length}
              onClick={toggleAllDiscardSelection}
              className="h-8 justify-start rounded-md px-2 text-[12px]"
            >
              <Check className="size-3.5" />
              {allSelected ? "전체 해제" : "전체 선택"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              disabled={!selectedThreadIds.length}
              onClick={() => {
                if (discardConfirming) void discardSelectedThreads()
                else setDiscardConfirming(true)
              }}
              className="h-8 rounded-md px-2 text-[12px]"
            >
              <Trash2 className="size-3.5" />
              {discardConfirming
                ? `정말 ${selectedThreadIds.length}개 버리기`
                : selectedThreadIds.length
                ? `${selectedThreadIds.length}개 버리기`
                : "버리기"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={cancelDiscardMode}
              aria-label="Cancel discard selection"
              className="h-8 w-8 rounded-md"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ) : null}
        {discardConfirming ? (
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded-md border border-[color-mix(in_srgb,var(--status-error)_32%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] px-2 py-1.5 text-[11px] text-[var(--muted-text)]">
            <span className="min-w-0">선택한 세션을 Recents에서 숨깁니다.</span>
            <button
              type="button"
              className="shrink-0 rounded px-1.5 py-0.5 text-[var(--ink)] hover:bg-[var(--row-hover)]"
              onClick={() => setDiscardConfirming(false)}
            >
              취소
            </button>
          </div>
        ) : null}
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

          {threadWindow.visibleItems.map((thread: any) => {
            const active = thread.id === state.thread?.id
            const threadId = String(thread.id || "")
            const selected = selectedDiscardIds.has(threadId)
            return (
              <SidebarThreadRow
                key={thread.id}
                active={active}
                discardMode={discardMode}
                onArchiveThread={archiveThread}
                onLoadThread={loadThread}
                onToggleSelection={toggleDiscardSelection}
                selected={selected}
                thread={thread}
              />
            )
          })}
          {threadWindow.hiddenAfter ? (
            <div className="flex flex-wrap items-center justify-center gap-2 px-2 py-2 text-[12px] text-[var(--muted-text)]">
              <span>{threadWindow.hiddenAfter}개 더 있음</span>
              <button type="button" className="rounded-md px-2 py-1 hover:bg-[var(--row-hover)]" onClick={threadWindow.showMore}>
                더 보기
              </button>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-[var(--hairline-soft)] px-2 py-2">
        <Button
          variant="ghost"
          onClick={openSettings}
          className="h-9 w-full justify-start gap-2 rounded-md text-[13.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]"
        >
          <Settings2 className="size-4 text-[var(--muted-text)]" /> Settings
        </Button>
      </div>
    </div>
  )
}

export function Sidebar({ state, desktopCollapsed = false }: { state: Record<string, any>; desktopCollapsed?: boolean }) {
  const isWide = useMediaQuery("(min-width: 1024px)")
  return (
    <>
      <div
        className={cn(
          "border-r border-[var(--hairline-soft)] bg-[var(--sidebar-bg)] transition-[width,opacity] duration-200 ease-out lg:h-full lg:w-[320px] lg:flex-col",
          desktopCollapsed ? "hidden" : "hidden lg:flex",
        )}
      >
        <SidebarBody state={state} />
      </div>
      <Sheet open={state.sidebarOpen && !isWide} onOpenChange={(open) => patchState({ sidebarOpen: open })}>
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
    <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" className="codex-mobile-header-circle rounded-md hover:bg-[var(--row-hover)] lg:hidden" onClick={() => patchState((current) => ({ sidebarOpen: !current.sidebarOpen }))}>
      <Menu className="size-4" />
    </Button>
  )
}
