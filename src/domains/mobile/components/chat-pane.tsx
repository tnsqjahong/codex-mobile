import { memo, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FileEdit,
  FileSearch,
  GitCompareArrows,
  Loader2,
  OctagonAlert,
  Play,
  RefreshCw,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react"

import { mobileController, mobileSelectors, patchState } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { ScrollArea } from "@/common/ui/scroll-area"
import { cn } from "@/common/lib/utils"
import { sanitize } from "@/common/lib/sanitize-html"
import { useChatStream } from "@/common/hooks/use-chat-stream"
import { useChangesFiles } from "@/common/hooks/use-changes-files"
import { useStickToBottom } from "@/common/hooks/use-stick-to-bottom"

const EMPTY_SUGGESTIONS: readonly string[] = [
  "현재 프로젝트 구조를 파악하고 다음 작업을 제안해줘",
  "변경 사항을 검토하고 위험한 부분을 찾아줘",
  "테스트를 실행하고 실패하면 고쳐줘",
]

function toolIconFor(type: string) {
  if (!type) return Sparkles
  if (type === "exec" || type === "shell" || type === "command" || type.startsWith("local_shell")) return Terminal
  if (type.includes("read") || type === "open" || type === "file_read") return FileSearch
  if (type.includes("edit") || type === "patch" || type === "write" || type.includes("apply")) return FileEdit
  if (type === "run" || type === "execute") return Play
  return Sparkles
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
        const src = attachment.previewUrl || attachment.url || mobileSelectors.localPreviewUrl(attachment)
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

function MessageBubbleImpl({ role, item }: { role: "user" | "agent"; item: any }) {
  // Cache parsed text + sanitized HTML keyed on the raw text length so streaming
  // deltas only re-parse/re-sanitize when the bubble's own text actually grew.
  // (Each item identity also changes per delta, but the heavy work is here.)
  const rawText = mobileSelectors.extractText(item)
  const rawTextLen = rawText.length
  const itemAttachments = item.attachments
  const { text, attachments } = useMemo(() => {
    const parsed = mobileSelectors.parseMentionedFilesText(rawText)
    const resolvedText = parsed?.text ?? rawText
    const resolvedAttachments = mobileSelectors.dedupeAttachments([
      ...(itemAttachments || []),
      ...(parsed?.attachments || []),
      ...mobileSelectors.extractAttachments(item),
    ])
    return { text: resolvedText, attachments: resolvedAttachments }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, rawTextLen, itemAttachments])

  const trimmed = text?.trim() ?? ""
  const html = useMemo(
    () => (trimmed ? sanitize(mobileSelectors.renderMarkdown(trimmed)) : ""),
    [trimmed],
  )

  if (role === "user") {
    if (!trimmed && !attachments.length) return null
    return (
      <div className="codex-fade-in rounded-lg bg-[var(--bubble-user)] px-4 py-3 text-[var(--ink)]">
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

function itemNode(item: any) {
  const type = item.type || item.kind || "unknown"
  const role = itemRole(item)
  if (role) return <MessageBubble role={role} item={item} />
  if (type === "localImage" || type === "image" || type === "image_url") return <MessageBubble role="user" item={{ attachments: mobileSelectors.extractAttachments(item), text: "" }} />
  return <ToolRow item={item} />
}

export function ChatPane({ state }: { state: Record<string, any> }) {
  const { items, approvals, isBusy, hasThread, startPending } = useChatStream(state)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const queueLength = state.messageQueue?.length || 0

  // Build the contentKey from primitive scalars so useStickToBottom's
  // useLayoutEffect doesn't fire on every parent render. `items` array
  // identity changes per token delta even when length/last id are stable.
  const lastItem = items[items.length - 1]
  const lastId = lastItem?.item?.id ?? ""
  const lastTextLen = lastItem ? mobileSelectors.extractText(lastItem.item).length : 0
  const contentKey = useMemo(
    () =>
      `${items.length}:${lastId}:${lastTextLen}:${isBusy ? 1 : 0}:${approvals.length}:${queueLength}`,
    [items.length, lastId, lastTextLen, isBusy, approvals.length, queueLength],
  )

  const stick = useStickToBottom({ ref: scrollRef, contentKey })

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
        className="h-full overflow-y-auto overflow-x-hidden px-3 pb-3 pt-3 [overflow-anchor:auto]"
      >
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 pb-2">
          {startPending ? (
            <MessageBubble role="user" item={{ text: startPending.text, attachments: startPending.attachments }} />
          ) : null}

          {items.map(({ key, item }) => {
            const node = itemNode(item)
            return node ? <div key={key}>{node}</div> : null
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
    </div>
  )
}

export function ChangesPane({ state }: { state: Record<string, any> }) {
  const { summary, turnDiff, files, loading, error } = useChangesFiles(state)

  return (
    <ScrollArea className="h-full overflow-x-hidden px-3 pb-3 pt-3">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--hairline-soft)] bg-transparent px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold text-[var(--ink-strong)]">{summary.filesChanged} files changed</div>
            <p className="mt-0.5 text-[12.5px] text-[var(--muted-text)]">+{summary.additions} / -{summary.deletions}</p>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="h-8 gap-1 rounded-md px-2.5 text-[12.5px] text-[var(--ink)] hover:bg-[var(--row-hover)]" onClick={() => state.thread?.id && void mobileController.loadChanges(state.thread.id)}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1 rounded-md px-2.5 text-[12.5px]" onClick={() => void mobileController.commitChanges()} disabled={!summary.filesChanged}>
              <CheckCircle2 className="size-3.5" /> Commit
            </Button>
          </div>
        </div>

        {loading ? <div className="text-[12.5px] text-[var(--muted-text)]">변경 사항을 새로고침 중입니다…</div> : null}
        {error ? <div className="text-[12.5px] text-[var(--status-error)]">{error}</div> : null}

        {turnDiff ? (
          <div className="rounded-lg border border-[var(--hairline-soft)] bg-transparent p-3">
            <div className="mb-2 flex items-center gap-2">
              <GitCompareArrows className="size-3.5 text-[var(--muted-text)]" />
              <span className="text-[13px] font-medium text-[var(--ink-strong)]">Latest turn diff</span>
              <span className="text-[11.5px] text-[var(--muted-text)]">{mobileSelectors.formatClock(turnDiff.updatedAt)}</span>
            </div>
            <pre className="max-h-[50svh] overflow-auto rounded-md border border-[var(--hairline-soft)] bg-[var(--code-block-bg)] p-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">{turnDiff.diff}</pre>
          </div>
        ) : null}

        {files.map((file: any) => (
          <div key={file.path} className="rounded-lg border border-[var(--hairline-soft)] bg-transparent p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[var(--ink-strong)]">{file.path}</div>
                <div className="mt-0.5 text-[11.5px] text-[var(--muted-text)]">{file.status} · +{file.additions || 0} / -{file.deletions || 0}</div>
              </div>
              <span className="rounded-full border border-[var(--hairline)] bg-[var(--canvas-soft)] px-2 py-0.5 text-[11px] font-medium uppercase text-[var(--muted-text)]">{file.status}</span>
            </div>
            {file.diff ? (
              <pre className="mt-2 max-h-[38svh] overflow-auto rounded-md border border-[var(--hairline-soft)] bg-[var(--code-block-bg)] p-2.5 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">{file.diff}</pre>
            ) : (
              <p className="mt-2 text-[12.5px] text-[var(--muted-text)]">Unified diff unavailable.</p>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
