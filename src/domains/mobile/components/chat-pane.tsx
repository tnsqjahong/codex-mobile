import { memo, useCallback, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Copy,
  FileEdit,
  FileSearch,
  GitCompareArrows,
  Loader2,
  OctagonAlert,
  Play,
  RefreshCw,
  Sparkles,
  Terminal,
  X,
  XCircle,
} from "lucide-react"

import { mobileController, mobileSelectors, patchState } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { ScrollArea } from "@/common/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/common/ui/sheet"
import { cn } from "@/common/lib/utils"
import { sanitize } from "@/common/lib/sanitize-html"
import { type ChatStreamItem, useChatStream } from "@/common/hooks/use-chat-stream"
import { useChangesFiles } from "@/common/hooks/use-changes-files"
import { useProgressiveWindow } from "@/common/hooks/use-progressive-window"
import { useStickToBottom } from "@/common/hooks/use-stick-to-bottom"

const EMPTY_SUGGESTIONS: readonly string[] = [
  "현재 프로젝트 구조를 파악하고 다음 작업을 제안해줘",
  "변경 사항을 검토하고 위험한 부분을 찾아줘",
  "테스트를 실행하고 실패하면 고쳐줘",
]

const CHAT_SKELETON_ROWS = Array.from({ length: 5 }, (_, index) => index)
const DIFF_HEADER_RE = /^diff --git/m
const DIFF_HUNK_RE = /^@@\s/m
const DIFF_LINE_RE = /(^|\n)[+-](?![+-+])/

function toolIconFor(type: string) {
  if (!type) return Sparkles
  if (isCommandType(type)) return Terminal
  if (type.includes("read") || type === "open" || type === "file_read") return FileSearch
  if (type.includes("edit") || type === "patch" || type === "write" || type.includes("apply")) return FileEdit
  if (type === "run" || type === "execute") return Play
  return Sparkles
}

function isCommandType(type: string) {
  const value = String(type || "").toLowerCase()
  return value === "commandexecution" || value === "exec" || value === "shell" || value === "command" || value.startsWith("local_shell")
}

function statusIconFor(tone: string) {
  if (tone === "done") return CheckCircle2
  if (tone === "danger") return XCircle
  if (tone === "busy") return Loader2
  return null
}

function statusVarFor(tone: string): string {
  if (tone === "done") return "var(--status-done)"
  if (tone === "danger") return "var(--status-error)"
  if (tone === "busy") return "var(--status-busy)"
  if (tone === "pending") return "var(--status-pending)"
  return "var(--muted-text-soft)"
}

function renderAttachments(attachments: any[]) {
  if (!attachments.length) return null
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {attachments.map((attachment, index) => {
        const name = attachment.name || mobileSelectors.pathBasename(attachment.path || attachment.url || "Attachment")
        const image = attachment.isImage || mobileSelectors.isImagePath(name) || mobileSelectors.isImagePath(attachment.path || attachment.url || "")
        const src = mobileSelectors.localPreviewUrl(attachment)
        if (image && src) {
          return (
            <figure key={`${name}-${index}`} className="overflow-hidden rounded-lg border border-[var(--hairline-soft)] bg-[var(--surface)]">
              <img src={src} alt={name} className="max-h-56 w-full max-w-56 object-cover" loading="lazy" />
              <figcaption className="px-2.5 py-1.5 text-[11.5px] text-[var(--muted-text)]">{name}</figcaption>
            </figure>
          )
        }
        return (
          <span key={`${name}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--canvas-soft)] px-2.5 py-0.5 text-[12px] text-[var(--muted-text)]">
            {name}
          </span>
        )
      })}
    </div>
  )
}

function attachmentSignature(attachments: any[]) {
  if (!attachments.length) return "0"
  return attachments
    .map((attachment) => `${attachment.id || attachment.name || attachment.path || attachment.url || ""}:${attachment.size || ""}`)
    .join("|")
}

function MessageBubbleImpl({ role, item }: { role: "user" | "agent"; item: any }) {
  const rawText = mobileSelectors.extractText(item)
  const itemAttachments = item.attachments
  const extractedAttachments = mobileSelectors.extractAttachments(item)
  const attachmentsKey = `${attachmentSignature(itemAttachments || [])}:${attachmentSignature(extractedAttachments)}`
  const { text, attachments } = useMemo(() => {
    const parsed = mobileSelectors.parseMentionedFilesText(rawText)
    const resolvedText = parsed?.text ?? rawText
    const resolvedAttachments = mobileSelectors.dedupeAttachments([
      ...(itemAttachments || []),
      ...(parsed?.attachments || []),
      ...extractedAttachments,
    ])
    return { text: resolvedText, attachments: resolvedAttachments }
  }, [attachmentsKey, rawText])

  const trimmed = text?.trim() ?? ""
  const html = useMemo(
    () => (trimmed ? sanitize(mobileSelectors.renderMarkdown(trimmed)) : ""),
    [trimmed],
  )

  if (role === "user") {
    if (!trimmed && !attachments.length) return null
    return (
      <div className="codex-fade-in ml-auto max-w-[92%] rounded-2xl bg-[var(--bubble-user)] px-4 py-3 text-[var(--ink)] shadow-[0_1px_0_var(--hairline-soft)_inset] sm:max-w-[86%]">
        {trimmed ? (
          <div className="prose-codex" dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
        {renderAttachments(attachments)}
      </div>
    )
  }

  return (
    <div className="codex-fade-in pt-1">
      {trimmed ? (
        <div className="prose-codex" dangerouslySetInnerHTML={{ __html: html }} />
      ) : null}
      {renderAttachments(attachments)}
    </div>
  )
}

const MessageBubble = memo(
  MessageBubbleImpl,
  (prev, next) => prev.role === next.role && prev.item === next.item,
)

function itemRole(item: any): "user" | "agent" | null {
  const type = String(item?.type || item?.kind || item?.itemType || "").toLowerCase()
  const role = String(item?.role || item?.author?.role || "").toLowerCase()
  if (role === "user" || type === "usermessage" || type === "user_message" || type === "message/user") return "user"
  if (role === "assistant" || role === "agent" || type === "agentmessage" || type === "agent_message" || type === "message/agent") return "agent"
  return null
}

function itemType(item: any) {
  return String(item?.type || item?.kind || item?.itemType || "unknown")
}

function isImageTimelineItem(item: any) {
  const type = itemType(item).toLowerCase()
  return type === "localimage" || type === "image" || type === "image_url"
}

function isToolTimelineItem(item: any) {
  return !itemRole(item) && !isImageTimelineItem(item)
}

function pluralKo(count: number, noun: string) {
  return `${noun} ${count}개`
}

function mcpToolName(item: any) {
  return String(item?.tool || item?.name || item?.function?.name || "")
}

function toolGroupKind(item: any): "browser" | "command" | "file" | "search" | "edit" | "tool" {
  const type = itemType(item).toLowerCase()
  const server = String(item?.server || "").toLowerCase()
  const tool = mcpToolName(item).toLowerCase()
  const command = String(item?.command || item?.commandActions?.[0]?.command || item?.arguments?.cmd || "")

  if (isCommandType(type) || tool.includes("exec") || tool.includes("command") || command) return "command"
  if (server.includes("browser") || server.includes("node_repl") || tool === "js" || tool.includes("screenshot")) return "browser"
  if (type.includes("search") || tool.includes("search") || tool === "find") return "search"
  if (
    type.includes("edit") ||
    type.includes("patch") ||
    type.includes("change") ||
    tool.includes("edit") ||
    tool.includes("patch") ||
    tool.includes("write") ||
    tool.includes("change")
  ) {
    return "edit"
  }
  if (
    type.includes("file") ||
    type.includes("read") ||
    tool.includes("read") ||
    tool.includes("open") ||
    tool.includes("list") ||
    tool.includes("get")
  ) {
    return "file"
  }
  return "tool"
}

function toolGroupSummary(items: any[]) {
  const counts = {
    browser: 0,
    command: 0,
    file: 0,
    search: 0,
    edit: 0,
    tool: 0,
  }
  for (const item of items) {
    counts[toolGroupKind(item)] += 1
  }
  const parts: string[] = []
  if (counts.file) parts.push(`${pluralKo(counts.file, "파일")} 탐색`)
  if (counts.search) parts.push(`${counts.search}회 검색`)
  if (counts.edit) parts.push(`${pluralKo(counts.edit, "파일")} 수정`)
  if (counts.command) parts.push(`${pluralKo(counts.command, "명령어")} 실행함`)
  if (counts.browser) parts.push(`브라우저 ${counts.browser}회 확인함`)
  if (counts.tool) parts.push(`${pluralKo(counts.tool, "도구")} 실행함`)
  return parts.join(", ") || "작업 세부 정보"
}

function toolGroupIcon(items: any[]) {
  const kinds = items.map(toolGroupKind)
  if (kinds.includes("command")) return Terminal
  if (kinds.includes("edit")) return FileEdit
  if (kinds.includes("file") || kinds.includes("search")) return FileSearch
  if (kinds.includes("browser")) return Sparkles
  return Sparkles
}

function summarizeToolGroup(items: any[]) {
  return {
    Icon: toolGroupIcon(items),
    summary: toolGroupSummary(items),
  }
}

function toolDetailTitle(item: any) {
  return isCommandType(itemType(item)) ? "Bash" : mobileSelectors.toolTitle(itemType(item))
}

function toolDetailLabel(item: any) {
  return isCommandType(itemType(item)) ? "명령어" : "세부 정보"
}

function toolPreview(item: any) {
  const type = itemType(item)
  return mobileSelectors.toolPreview(type, item) || mobileSelectors.toolSummary(type, item) || JSON.stringify(item, null, 2)
}

function toolListPreview(item: any) {
  const type = itemType(item)
  return mobileSelectors.toolSummary(type, item) || mobileSelectors.toolPreview(type, item) || "세부 정보 보기"
}

function isDiffPreview(preview: string) {
  return DIFF_HEADER_RE.test(preview) || DIFF_HUNK_RE.test(preview) || DIFF_LINE_RE.test(preview)
}

type ChatDisplayItemRow = ChatStreamItem & {
  kind: "item"
}

type ChatDisplayToolGroupRow = {
  kind: "toolGroup"
  key: string
  items: any[]
  turn: any
  isLastInTurn: boolean
}

type ChatDisplayRow = ChatDisplayItemRow | ChatDisplayToolGroupRow

function buildDisplayRows(items: ChatStreamItem[]): ChatDisplayRow[] {
  const rows: ChatDisplayRow[] = []
  let group: ChatDisplayToolGroupRow | null = null

  const flush = () => {
    if (!group) return
    rows.push(group)
    group = null
  }

  for (const entry of items) {
    if (isToolTimelineItem(entry.item)) {
      if (group && group.turn === entry.turn) {
        group.items.push(entry.item)
        group.isLastInTurn = entry.isLastInTurn
      } else {
        flush()
        group = {
          kind: "toolGroup",
          key: `tool-group-${entry.key}`,
          items: [entry.item],
          turn: entry.turn,
          isLastInTurn: entry.isLastInTurn,
        }
      }
      continue
    }

    flush()
    rows.push({ ...entry, kind: "item" })
  }

  flush()
  return rows
}

function ToolGroupLine({ items, onOpen }: { items: any[]; onOpen: () => void }) {
  const { Icon, summary } = useMemo(() => summarizeToolGroup(items), [items])
  return (
    <button
      type="button"
      className="codex-tool-summary-line codex-fade-in group flex max-w-full items-center gap-2 self-start rounded-md px-1 py-1.5 text-left text-[13.5px] font-medium text-[var(--muted-text-soft)] transition-colors hover:bg-[var(--row-hover)] hover:text-[var(--muted-text)]"
      onClick={onOpen}
      aria-label={`${summary} 세부 정보 열기`}
    >
      <span className="grid size-5 shrink-0 place-items-center rounded-md border border-[var(--hairline)] text-[var(--muted-text-soft)]">
        <Icon className="size-3.5" />
      </span>
      <span className="truncate">{summary}</span>
      <ChevronRight className="size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" />
    </button>
  )
}

const MemoToolGroupLine = memo(
  ToolGroupLine,
  (prev, next) => prev.items === next.items && prev.onOpen === next.onOpen,
)

type ToolSheetState = {
  groupKey: string
  selectedIndex: number | null
}

function ToolSheet({
  items,
  selectedIndex,
  onClose,
  onSelect,
}: {
  items: any[]
  selectedIndex: number | null
  onClose: () => void
  onSelect: (index: number | null) => void
}) {
  const selectedItem = selectedIndex == null ? null : items[selectedIndex]
  const groupSummary = useMemo(() => toolGroupSummary(items), [items])
  const title = selectedItem ? toolDetailTitle(selectedItem) : groupSummary
  const rows = useMemo(
    () =>
      items.map((item, index) => {
        const type = itemType(item)
        const preview = toolListPreview(item)
        return {
          Icon: toolIconFor(type),
          item,
          key: `${type}-${index}-${preview}`,
          preview,
          title: toolDetailTitle(item),
        }
      }),
    [items],
  )

  return (
    <Sheet open onOpenChange={(open) => {
      if (!open) onClose()
    }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="codex-tool-drawer max-h-[78svh] w-full max-w-none gap-0 overflow-hidden rounded-t-3xl border-[var(--hairline-soft)] bg-[var(--surface-warm)] p-0 shadow-[0_-18px_54px_rgba(0,0,0,0.5)]"
      >
        <div className="codex-tool-sheet-handle" />
        <SheetHeader className="codex-tool-sheet-header">
          {selectedItem ? (
            <button type="button" className="codex-tool-sheet-round-button" aria-label="Back to tool list" onClick={() => onSelect(null)}>
              <ChevronLeft className="size-4" />
            </button>
          ) : (
            <button type="button" className="codex-tool-sheet-round-button" aria-label="Close tool details" onClick={onClose}>
              <X className="size-4" />
            </button>
          )}
          <SheetTitle className="codex-tool-sheet-title">{title}</SheetTitle>
          <SheetDescription className="sr-only">실행된 명령어와 도구 호출 세부 정보를 확인합니다.</SheetDescription>
          <span className="size-9" aria-hidden="true" />
        </SheetHeader>

        {selectedItem ? (
          <ToolDetailContent item={selectedItem} />
        ) : (
          <div className="codex-tool-sheet-list">
            {rows.map(({ Icon, key, preview, title }, index) => {
              return (
                <button
                  key={key}
                  type="button"
                  className="codex-tool-sheet-row"
                  onClick={() => onSelect(index)}
                >
                  <span className="codex-tool-sheet-row-icon">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="codex-tool-sheet-row-title">{title}</span>
                    {" "}
                    <span className="codex-tool-sheet-row-preview">{preview}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function ToolDetailContent({ item }: { item: any }) {
  const preview = toolPreview(item)
  const isDiff = isDiffPreview(preview)
  return (
    <div className={cn("codex-tool-sheet-detail", isDiff && "codex-tool-sheet-detail-wide")}>
      <div className="codex-tool-sheet-section-label">{toolDetailLabel(item)}</div>
      {isDiff ? (
        <DiffBlock diff={preview} maxHeightClass="max-h-[calc(78svh-142px)]" />
      ) : (
        <pre className="codex-tool-sheet-code">{preview}</pre>
      )}
    </div>
  )
}

function ToolRowImpl({ item }: { item: any }) {
  const [open, setOpen] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const type = item.type || item.kind || "unknown"
  // Cache derived selectors per item identity. `item` reference only changes when
  // the underlying tool entry actually mutates (status flip, output append).
  const { tone, title, summary, preview } = useMemo(() => {
    const t = mobileSelectors.threadStatusTone(
      mobileSelectors.formatThreadStatus(item.status || item.outcome || item.result?.status),
    )
    return {
      tone: t,
      title: mobileSelectors.toolTitle(type),
      summary: mobileSelectors.toolSummary(type, item),
      preview: mobileSelectors.toolPreview(type, item),
    }
  }, [item, type])

  const ToolIcon = toolIconFor(type)
  const StatusIcon = statusIconFor(tone)
  const accent = statusVarFor(tone)

  return (
    <div className="codex-fade-in">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-[var(--muted-text)] transition-colors hover:bg-[var(--row-hover)]"
        aria-expanded={open}
      >
        <ToolIcon className="size-3.5 shrink-0" style={{ color: accent }} />
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <span className="shrink-0 font-medium text-[var(--ink-strong)]">{title}</span>
          {summary ? (
            <span className="truncate text-[var(--muted-text)]">· {summary}</span>
          ) : null}
        </span>
        {StatusIcon ? (
          <StatusIcon
            className={cn("size-3.5 shrink-0", tone === "busy" && "animate-spin")}
            style={{ color: accent }}
          />
        ) : null}
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-[var(--muted-text)]" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-[var(--muted-text)]" />
        )}
      </button>
      {open ? (
        <div
          className="codex-expand mt-1.5 rounded-lg border border-[var(--hairline-soft)] bg-[var(--code-block-bg)] px-3 py-2.5 text-[12.5px] text-[var(--ink)]"
          style={{ borderInlineStartWidth: 2, borderInlineStartColor: accent }}
        >
          {preview ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-[var(--ink)]">{preview}</pre>
          ) : (
            <p className="text-[var(--muted-text)]">No preview available.</p>
          )}
          <div className="mt-2 flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-md px-2 text-[11.5px] text-[var(--muted-text)] hover:bg-[var(--row-hover)] hover:text-[var(--ink)]"
              onClick={() => setShowJson((value) => !value)}
            >
              {showJson ? "원본 JSON 숨기기" : "원본 JSON"}
            </Button>
          </div>
          {showJson ? (
            <pre className="codex-fade-in mt-2 max-h-72 overflow-auto rounded-md border border-[var(--hairline-soft)] bg-[var(--surface)] p-2 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">
              {JSON.stringify(item, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const ToolRow = memo(ToolRowImpl, (prev, next) => prev.item === next.item)

function ApprovalCard({ approval }: { approval: any }) {
  const summary = mobileSelectors.summarizeApproval(approval)
  return (
    <div className="codex-fade-in rounded-lg border border-[var(--primary)]/35 bg-transparent px-3 py-2.5">
      <div className="flex items-start gap-2">
        <OctagonAlert className="mt-0.5 size-4 shrink-0 text-[var(--primary)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-[var(--ink-strong)]">{summary.title}</div>
          {summary.detail ? (
            <div className="mt-0.5 break-words text-[12.5px] text-[var(--muted-text)]">{summary.detail}</div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" className="h-7 rounded-md px-2.5 text-[12.5px]" onClick={() => void mobileController.answerApproval(approval.requestId, "allow", false)}>허용</Button>
            <Button size="sm" variant="secondary" className="h-7 rounded-md bg-[var(--canvas-soft)] px-2.5 text-[12.5px]" onClick={() => void mobileController.answerApproval(approval.requestId, "allow", true)}>세션 동안 허용</Button>
            <Button size="sm" variant="ghost" className="h-7 rounded-md px-2.5 text-[12.5px] text-[var(--muted-text)] hover:text-[var(--ink)]" onClick={() => void mobileController.answerApproval(approval.requestId, "deny", false)}>거절</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QueuedCard({ state }: { state: Record<string, any> }) {
  if (!state.messageQueue?.length) return null
  return (
    <div className="rounded-lg border border-[var(--hairline-soft)] bg-transparent px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--muted-text)]">
        <CornerDownRight className="size-3.5" />
        <span>{state.messageQueue.length}개 메시지가 대기 중</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {state.messageQueue.map((message: any, index: number) => (
          <div key={message.id} className="rounded-md border border-[var(--hairline-soft)] bg-transparent px-2.5 py-2">
            <div className="text-[11px] text-[var(--muted-text)]">#{index + 1}</div>
            <p className="mt-0.5 text-[13px] text-[var(--ink)]">{message.text || `${(message.attachments || []).length} attachments`}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="h-6 rounded-md px-1.5 text-[11.5px] text-[var(--muted-text)] hover:text-[var(--ink)]" onClick={() => void mobileController.steerQueuedMessage(message.id)}>바로 보내기</Button>
              <Button size="sm" variant="ghost" className="h-6 rounded-md px-1.5 text-[11.5px] text-[var(--muted-text)] hover:text-[var(--ink)]" onClick={() => mobileController.editQueuedMessage(message.id)}>편집</Button>
              <Button size="sm" variant="ghost" className="h-6 rounded-md px-1.5 text-[11.5px] text-[var(--muted-text)] hover:text-[var(--ink)]" onClick={() => mobileController.removeQueuedMessage(message.id)}>삭제</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatLoadingSkeleton() {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
      </div>
      <div className="space-y-3">
        {CHAT_SKELETON_ROWS.map((index) => (
          <div key={index} className="rounded-lg border border-[var(--hairline-soft)] bg-[var(--surface)]/25 px-4 py-3">
            <div className="h-3 w-full animate-pulse rounded-full bg-[var(--canvas-soft)]" />
            <div className="mt-2 h-3 w-5/6 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded-full bg-[var(--canvas-soft)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

function itemNode(item: any) {
  const type = itemType(item)
  const role = itemRole(item)
  if (role) return <MessageBubble role={role} item={item} />
  if (isImageTimelineItem(item)) return <MessageBubble role="user" item={{ attachments: mobileSelectors.extractAttachments(item), text: "" }} />
  return <ToolRow item={item} />
}

function timestampMs(value: any) {
  if (!value) return 0
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : 0
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return timestampMs(numeric)
    return 0
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return value > 1_000_000_000_000 ? value : value * 1000
}

function turnCompletedClock(turn: any) {
  const completedAt = timestampMs(
    turn?.completedAt ||
      turn?.completed_at ||
      turn?.finishedAt ||
      turn?.finished_at ||
      turn?.updatedAt ||
      turn?.updated_at,
  )
  return completedAt ? mobileSelectors.formatClock(completedAt) : ""
}

function rowTurnKey(row: ChatDisplayRow) {
  return String(row.turn?.id || row.key)
}

function lastAssistantRowKeys(rows: ChatDisplayRow[]) {
  const lastByTurn = new Map<string, string>()
  for (const row of rows) {
    if (row.kind !== "item" || itemRole(row.item) !== "agent") continue
    lastByTurn.set(rowTurnKey(row), row.key)
  }
  return new Set(lastByTurn.values())
}

function assistantCopyTextByTurn(rows: ChatDisplayRow[]) {
  const byTurn = new Map<string, string[]>()
  for (const row of rows) {
    if (row.kind !== "item" || itemRole(row.item) !== "agent") continue
    const text = mobileSelectors.extractText(row.item).trim()
    if (!text) continue
    const key = rowTurnKey(row)
    const parts = byTurn.get(key)
    if (parts) parts.push(text)
    else byTurn.set(key, [text])
  }
  return new Map([...byTurn.entries()].map(([key, parts]) => [key, parts.join("\n\n")]))
}

function MessageFooter({
  clock,
  copied,
  onCopy,
}: {
  clock: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="codex-message-footer codex-fade-in">
      {clock ? <span className="tabular-nums">{clock}</span> : null}
      <button type="button" className="codex-message-footer-button" aria-label="응답 복사" onClick={onCopy}>
        {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

function TurnWorkHeader({ turn }: { turn: any }) {
  const durationMs = mobileSelectors.turnDurationMs(turn)
  const duration = mobileSelectors.formatDuration(durationMs)
  const completedClock = turnCompletedClock(turn)
  const rawStatus = mobileSelectors.formatThreadStatus(turn?.status)
  const tone = mobileSelectors.threadStatusTone(rawStatus)
  const busy = tone === "busy" || tone === "pending"
  const label = duration ? `${duration} 동안 작업` : busy ? "작업 중" : "작업"

  return (
    <div className="codex-turn-work-header codex-fade-in">
      <button type="button" className="codex-turn-work-header-button" aria-label={`${label}${completedClock ? `, ${completedClock}` : ""}`}>
        <span className="tabular-nums">{label}</span>
        <ChevronDown className={cn("size-4 shrink-0", busy && "text-[var(--status-busy)]")} />
      </button>
      <span className="codex-turn-work-rule" aria-hidden="true" />
    </div>
  )
}

function isWorkRow(row: ChatDisplayRow) {
  if (row.kind === "toolGroup") return true
  return itemRole(row.item) !== "user" && !isImageTimelineItem(row.item)
}

function firstWorkRowKeys(rows: ChatDisplayRow[]) {
  const keys = new Set<string>()
  const seenTurns = new Set<string>()
  for (const row of rows) {
    const turnId = String(row.turn?.id || row.key)
    if (seenTurns.has(turnId) || !isWorkRow(row)) continue
    seenTurns.add(turnId)
    keys.add(row.key)
  }
  return keys
}

type ChatTimelineRowProps = {
  assistantCopyText: string
  copied: boolean
  onCopyAssistant: (rowKey: string, copyText: string) => void
  onOpenToolGroup: (groupKey: string) => void
  row: ChatDisplayRow
  showAssistantFooter: boolean
  showWorkHeader: boolean
}

function sameToolItems(prev: any[], next: any[]) {
  if (prev === next) return true
  if (prev.length !== next.length) return false
  for (let index = 0; index < prev.length; index += 1) {
    if (prev[index] !== next[index]) return false
  }
  return true
}

function sameDisplayRow(prev: ChatDisplayRow, next: ChatDisplayRow) {
  if (prev.kind !== next.kind || prev.key !== next.key || prev.turn !== next.turn) return false
  if (prev.kind === "toolGroup" && next.kind === "toolGroup") {
    return prev.isLastInTurn === next.isLastInTurn && sameToolItems(prev.items, next.items)
  }
  if (prev.kind === "item" && next.kind === "item") {
    return prev.item === next.item && prev.isLastInTurn === next.isLastInTurn
  }
  return false
}

function ChatTimelineRowImpl({
  assistantCopyText,
  copied,
  onCopyAssistant,
  onOpenToolGroup,
  row,
  showAssistantFooter,
  showWorkHeader,
}: ChatTimelineRowProps) {
  const openToolGroup = useCallback(() => {
    onOpenToolGroup(row.key)
  }, [onOpenToolGroup, row.key])
  const copyAssistant = useCallback(() => {
    onCopyAssistant(row.key, assistantCopyText)
  }, [assistantCopyText, onCopyAssistant, row.key])
  const workHeader = showWorkHeader ? <TurnWorkHeader turn={row.turn} /> : null

  if (row.kind === "toolGroup") {
    return (
      <div className="codex-windowed-row flex flex-col gap-1.5">
        {workHeader}
        <MemoToolGroupLine items={row.items} onOpen={openToolGroup} />
      </div>
    )
  }

  const node = itemNode(row.item)
  if (!node) return null

  return (
    <div className="codex-windowed-row flex flex-col gap-1.5">
      {workHeader}
      {node}
      {showAssistantFooter ? (
        <MessageFooter
          clock={turnCompletedClock(row.turn)}
          copied={copied}
          onCopy={copyAssistant}
        />
      ) : null}
    </div>
  )
}

const ChatTimelineRow = memo(
  ChatTimelineRowImpl,
  (prev, next) =>
    prev.assistantCopyText === next.assistantCopyText &&
    prev.copied === next.copied &&
    prev.onCopyAssistant === next.onCopyAssistant &&
    prev.onOpenToolGroup === next.onOpenToolGroup &&
    prev.showAssistantFooter === next.showAssistantFooter &&
    prev.showWorkHeader === next.showWorkHeader &&
    sameDisplayRow(prev.row, next.row),
)

export function ChatPane({ state }: { state: Record<string, any> }) {
  const { items, approvals, isBusy, hasThread, startPending } = useChatStream(state)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [toolSheet, setToolSheet] = useState<ToolSheetState | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const queueLength = state.messageQueue?.length || 0
  const displayRows = useMemo(() => buildDisplayRows(items), [items])
  const workHeaderKeys = useMemo(() => firstWorkRowKeys(displayRows), [displayRows])
  const assistantFooterKeys = useMemo(() => lastAssistantRowKeys(displayRows), [displayRows])
  const assistantCopyByTurn = useMemo(() => assistantCopyTextByTurn(displayRows), [displayRows])
  const activeToolGroup = useMemo(
    () => toolSheet
      ? displayRows.find((row): row is ChatDisplayToolGroupRow => row.kind === "toolGroup" && row.key === toolSheet.groupKey)
      : null,
    [displayRows, toolSheet?.groupKey],
  )
  const openToolGroup = useCallback((groupKey: string) => {
    setToolSheet({ groupKey, selectedIndex: null })
  }, [])
  const closeToolSheet = useCallback(() => {
    setToolSheet(null)
  }, [])
  const selectToolSheetItem = useCallback((selectedIndex: number | null) => {
    setToolSheet((current) => current ? { ...current, selectedIndex } : null)
  }, [])
  const copyAssistantText = useCallback((rowKey: string, copyText: string) => {
    if (!copyText) return
    const write = navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(copyText)
      : Promise.resolve()
    void write.then(() => {
      setCopiedKey(rowKey)
      window.setTimeout(() => setCopiedKey((current) => current === rowKey ? null : current), 1200)
    })
  }, [])
  const itemsWindow = useProgressiveWindow<ChatDisplayRow>(displayRows, {
    initialCount: 90,
    step: 45,
    direction: "tail",
    resetKey: state.thread?.id || "new",
  })

  // Build the contentKey from primitive scalars so useStickToBottom's
  // useLayoutEffect doesn't fire on every parent render. `items` array
  // identity changes per token delta even when length/last id are stable.
  const lastItem = items[items.length - 1]
  const lastId = lastItem?.item?.id ?? ""
  const lastTextLen = lastItem ? mobileSelectors.extractText(lastItem.item).length : 0
  const lastTurnDuration = lastItem ? mobileSelectors.turnDurationMs(lastItem.turn) : 0
  const lastTurnStatus = lastItem?.turn?.status || ""
  const contentKey = useMemo(
    () =>
      `${displayRows.length}:${items.length}:${lastId}:${lastTextLen}:${lastTurnStatus}:${lastTurnDuration}:${isBusy ? 1 : 0}:${approvals.length}:${queueLength}`,
    [displayRows.length, items.length, lastId, lastTextLen, lastTurnStatus, lastTurnDuration, isBusy, approvals.length, queueLength],
  )

  const stick = useStickToBottom({ ref: scrollRef, contentKey })

  if (!hasThread && !startPending && (state.projectsLoading || state.threadsLoading || state.threadLoading)) {
    return <ChatLoadingSkeleton />
  }

  if (!hasThread && !startPending) {
    const projectName = state.selectedProject?.name || "현재 프로젝트"
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center px-4 py-10">
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--ink-strong)]">무엇을 도와드릴까요?</h1>
        <p className="mt-1 text-[13.5px] text-[var(--muted-text)]">
          {projectName} 기준으로 Codex에게 자연어로 작업을 요청해보세요.
        </p>
        <div className="mt-5 space-y-1.5">
          {EMPTY_SUGGESTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="group flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-[13.5px] text-[var(--ink)] transition-colors hover:bg-[var(--row-hover)]"
              onClick={() => patchState({ draftText: prompt })}
            >
              <Sparkles className="size-3.5 text-[var(--muted-text)] group-hover:text-[var(--primary)]" />
              <span>{prompt}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const showJumpButton = stick.hasOverflow && !stick.isAtBottom

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={stick.onScroll}
        className="codex-mobile-chat-scroll h-full overflow-y-auto overflow-x-hidden px-5 pb-4 pt-4 [overflow-anchor:auto] sm:px-3 sm:pb-3 sm:pt-3"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 pb-2">
          {startPending ? (
            <MessageBubble role="user" item={{ text: startPending.text, attachments: startPending.attachments }} />
          ) : null}

          {itemsWindow.hiddenBefore ? (
            <div className="codex-virtual-window-controls flex flex-wrap items-center justify-center gap-2 rounded-lg border border-[var(--hairline-soft)] bg-transparent px-3 py-2 text-[12.5px] text-[var(--muted-text)]">
              <span>{itemsWindow.hiddenBefore}개 이전 항목은 렌더링을 줄이기 위해 접어뒀습니다.</span>
              <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[12px]" onClick={itemsWindow.showMore}>
                더 보기
              </Button>
              <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[12px]" onClick={itemsWindow.showAll}>
                전체 보기
              </Button>
            </div>
          ) : null}

          {itemsWindow.visibleItems.map((row) => {
            const showAssistantFooter = row.kind === "item" && assistantFooterKeys.has(row.key) && itemRole(row.item) === "agent"
            return (
              <ChatTimelineRow
                key={row.key}
                assistantCopyText={showAssistantFooter ? assistantCopyByTurn.get(rowTurnKey(row)) || mobileSelectors.extractText(row.item).trim() : ""}
                copied={copiedKey === row.key}
                onCopyAssistant={copyAssistantText}
                onOpenToolGroup={openToolGroup}
                row={row}
                showAssistantFooter={showAssistantFooter}
                showWorkHeader={workHeaderKeys.has(row.key)}
              />
            )
          })}

          {isBusy ? (
            <div className="codex-fade-in inline-flex items-center gap-2 self-start rounded-md px-2 py-1 text-[12.5px] text-[var(--muted-text)]">
              <Loader2 className="size-3.5 animate-spin text-[var(--primary)]" />
              Codex가 작업 중입니다.
            </div>
          ) : null}

          <QueuedCard state={state} />

          {approvals.map((approval: any) => (
            <div key={approval.requestId}>
              <ApprovalCard approval={approval} />
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        aria-label="Scroll to bottom"
        tabIndex={showJumpButton ? 0 : -1}
        aria-hidden={!showJumpButton}
        onClick={() => stick.scrollToBottom()}
        className={cn(
          "absolute bottom-3 left-1/2 z-20 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-[var(--hairline)] bg-[var(--surface-warm)]/90 text-[var(--ink-strong)] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)] backdrop-blur-md transition-[opacity,transform] motion-safe:duration-200",
          showJumpButton
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-2 opacity-0",
        )}
      >
          <ArrowDown className="size-4" />
      </button>
      {toolSheet && activeToolGroup ? (
        <ToolSheet
          items={activeToolGroup.items}
          selectedIndex={toolSheet.selectedIndex}
          onClose={closeToolSheet}
          onSelect={selectToolSheetItem}
        />
      ) : null}
    </div>
  )
}

export function ChangesPane({ state }: { state: Record<string, any> }) {
  const {
    summary,
    turnDiff,
    files,
    repositories,
    canCommit,
    workspace,
    truncatedFiles,
    truncatedRepositories,
    loading,
    error,
  } = useChangesFiles(state)
  const filesWindow = useProgressiveWindow(files, {
    initialCount: 60,
    step: 40,
    direction: "head",
    resetKey: `${state.thread?.id || ""}:${summary.filesChanged}:${state.changesLoading ? "loading" : "ready"}`,
  })
  const groupedFiles = useMemo(() => {
    const groups = new Map<string, typeof files>()
    for (const file of filesWindow.visibleItems) {
      const key = file.repoPath || file.repo || "."
      const list = groups.get(key) || []
      list.push(file)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [filesWindow.visibleItems])

  return (
    <ScrollArea className="h-full overflow-x-hidden px-3 pb-3 pt-3">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--hairline-soft)] bg-[var(--surface)]/30 px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-[var(--ink-strong)]">{summary.filesChanged} files changed</div>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted-text)]">
              <span className="text-emerald-300">+{summary.additions}</span>
              <span className="mx-1.5 text-[var(--muted-text)]">/</span>
              <span className="text-rose-300">-{summary.deletions}</span>
              {workspace ? <span className="ml-2">workspace scan</span> : null}
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-md px-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]" onClick={() => state.thread?.id && void mobileController.loadChanges(state.thread.id)}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1 rounded-md px-2.5 text-[12.5px]"
              onClick={() => void mobileController.commitChanges()}
              disabled={!summary.filesChanged || !canCommit}
              title={canCommit ? "Commit current repository changes" : "Commit is available only inside a single git repository"}
            >
              <CheckCircle2 className="size-3.5" /> Commit
            </Button>
          </div>
        </div>

        {loading ? <div className="text-[12.5px] text-[var(--muted-text)]">변경 사항을 새로고침 중입니다...</div> : null}
        {error ? <div className="text-[12.5px] text-[var(--status-error)]">{error}</div> : null}
        {workspace ? (
          <div className="rounded-lg border border-[var(--hairline-soft)] bg-[var(--canvas-soft)] px-3 py-2 text-[12px] text-[var(--muted-text)]">
            현재 폴더가 git repo가 아니어서 하위 repo의 변경사항을 모아 보여줍니다.
            {truncatedRepositories ? <span className="ml-1">Repo {truncatedRepositories}개는 제한 때문에 생략됐습니다.</span> : null}
          </div>
        ) : null}
        {repositories.length ? (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {repositories.map((repo: any) => (
              <span key={repo.root} className="shrink-0 rounded-full border border-[var(--hairline-soft)] bg-[var(--surface)] px-2.5 py-1 text-[11.5px] text-[var(--ink)]">
                {repo.repoPath || repo.repo} · {repo.summary?.filesChanged || 0}
              </span>
            ))}
          </div>
        ) : null}

        {turnDiff ? (
          <div className="rounded-lg border border-[var(--hairline-soft)] bg-transparent p-3">
            <div className="mb-2 flex items-center gap-2">
              <GitCompareArrows className="size-3.5 text-[var(--muted-text)]" />
              <span className="text-[13px] font-medium text-[var(--ink-strong)]">Latest turn diff</span>
              <span className="text-[11.5px] text-[var(--muted-text)]">{mobileSelectors.formatClock(turnDiff.updatedAt)}</span>
            </div>
            <DiffBlock diff={turnDiff.diff} maxHeightClass="max-h-[50svh]" />
          </div>
        ) : null}

        {groupedFiles.length ? groupedFiles.map(([group, groupFiles]) => (
          <div key={group} className="flex flex-col gap-2">
            {workspace ? (
              <div className="sticky top-0 z-10 rounded-md border border-[var(--hairline-soft)] bg-[var(--canvas)]/95 px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink-strong)] backdrop-blur">
                {group}
              </div>
            ) : null}
            {groupFiles.map((file: any) => (
              <details key={`${file.repoPath || ""}:${file.path}`} className="codex-windowed-row group rounded-lg border border-[var(--hairline-soft)] bg-transparent p-0" open>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2.5">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className={cn("mt-0.5 rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold", statusBadgeClass(file.status))}>{file.status}</span>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12.5px] font-medium text-[var(--ink-strong)]">{file.displayPath || file.path}</div>
                      <div className="mt-0.5 text-[11.5px] text-[var(--muted-text)]">
                        <span className="text-emerald-300">+{file.additions ?? 0}</span>
                        <span className="mx-1.5">/</span>
                        <span className="text-rose-300">-{file.deletions ?? 0}</span>
                        {file.truncatedDiff ? <span className="ml-2">diff truncated</span> : null}
                      </div>
                    </div>
                  </div>
                  <ChevronDown className="mt-1 size-3.5 shrink-0 text-[var(--muted-text)] transition-transform group-open:rotate-180" />
                </summary>
                {file.diff ? (
                  <div className="border-t border-[var(--hairline-soft)]">
                    <DiffBlock diff={file.diff} maxHeightClass="max-h-[46svh]" />
                  </div>
                ) : (
                  <p className="border-t border-[var(--hairline-soft)] px-3 py-2 text-[12.5px] text-[var(--muted-text)]">
                    {file.diffUnavailableReason || "Unified diff unavailable."}
                  </p>
                )}
              </details>
            ))}
          </div>
        )) : (
          <p className="rounded-lg border border-[var(--hairline-soft)] px-3 py-5 text-center text-[12.5px] text-[var(--muted-text)]">No working tree changes.</p>
        )}
        {truncatedFiles ? (
          <p className="text-[12px] text-[var(--muted-text)]">파일 {truncatedFiles}개는 표시 제한 때문에 생략됐습니다.</p>
        ) : null}
        {filesWindow.hiddenAfter ? (
          <div className="codex-virtual-window-controls flex flex-wrap items-center justify-center gap-2 rounded-lg border border-[var(--hairline-soft)] bg-transparent px-3 py-2 text-[12.5px] text-[var(--muted-text)]">
            <span>{filesWindow.hiddenAfter}개 파일은 초기 렌더링에서 접어뒀습니다.</span>
            <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[12px]" onClick={filesWindow.showMore}>
              더 보기
            </Button>
            <Button variant="ghost" size="sm" className="h-7 rounded-md px-2 text-[12px]" onClick={filesWindow.showAll}>
              전체 보기
            </Button>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  )
}

function statusBadgeClass(status: string) {
  if (status.includes("?")) return "bg-sky-500/15 text-sky-200"
  if (status.includes("A")) return "bg-emerald-500/15 text-emerald-200"
  if (status.includes("D")) return "bg-rose-500/15 text-rose-200"
  if (status.includes("R")) return "bg-violet-500/15 text-violet-200"
  return "bg-amber-500/15 text-amber-100"
}

function diffLineClass(line: string) {
  if (line.startsWith("diff --git")) return "border-l-2 border-amber-300/70 bg-amber-500/10 text-amber-100"
  if (line.startsWith("@@")) return "border-l-2 border-sky-300/70 bg-sky-500/10 text-sky-100"
  if (line.startsWith("+++") || line.startsWith("---")) return "border-l-2 border-sky-300/50 text-sky-200"
  if (line.startsWith("+")) return "border-l-2 border-emerald-300/80 bg-emerald-500/10 text-emerald-100"
  if (line.startsWith("-")) return "border-l-2 border-rose-300/80 bg-rose-500/10 text-rose-100"
  return "border-l-2 border-transparent text-[var(--ink)]"
}

function DiffBlockImpl({ diff, maxHeightClass }: { diff: string; maxHeightClass: string }) {
  const lines = useMemo(() => String(diff || "").split("\n"), [diff])
  return (
    <pre className={cn("codex-diff-block w-full max-w-full overflow-auto rounded-md border border-[var(--hairline-soft)] bg-[var(--code-block-bg)] py-2 font-mono text-[11.5px] leading-relaxed", maxHeightClass)}>
      {lines.map((line, index) => (
        <span key={index} className={cn("block min-w-full w-max px-2.5", diffLineClass(line))}>
          {line || " "}
        </span>
      ))}
    </pre>
  )
}

const DiffBlock = memo(DiffBlockImpl)
