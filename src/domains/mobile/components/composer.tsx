import { Brain, Paperclip, Send, Shield, Square, X } from "lucide-react"

import { Button } from "@/common/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/common/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/common/ui/select"
import { Textarea } from "@/common/ui/textarea"
import { cn } from "@/common/lib/utils"
import { useComposer } from "@/common/hooks/use-composer"

export function Composer({ state }: { state: Record<string, any> }) {
  const composer = useComposer(state)

  return (
    <div className="px-3 pb-[calc(env(safe-area-inset-bottom)+0.65rem)] pt-2">
      {composer.attachments.length ? (
        <div className="mx-auto mb-1.5 flex w-full max-w-3xl flex-wrap gap-1.5">
          {composer.attachments.map((attachment: any) => (
            <span
              key={attachment.id}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--canvas-soft)] px-2 py-0.5 text-[11.5px] text-[var(--ink)]"
            >
              {attachment.name}
              <button
                type="button"
                aria-label="Remove attachment"
                className="ml-0.5 inline-flex rounded-full p-0.5 text-[var(--muted-text)] hover:bg-[var(--row-hover)] hover:text-[var(--ink)]"
                onClick={() => composer.onRemoveAttachment(attachment.id)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <form
        className="codex-floating-pad mx-auto w-full max-w-3xl p-1.5"
        onSubmit={composer.onSubmit}
      >
        <Textarea
          id="message-input"
          value={composer.draftText}
          onChange={(event) => composer.onDraftChange(event.target.value)}
          placeholder={composer.thread ? "Codex에게 메시지 보내기" : "Codex에게 무엇을 도와줄지 설명해보세요"}
          className="min-h-[56px] resize-none rounded-xl border-0 bg-transparent px-2.5 py-2 text-[14.5px] leading-relaxed shadow-none placeholder:text-[var(--muted-text-soft)] focus-visible:ring-0"
        />

        <div className="mt-1 flex min-w-0 flex-nowrap items-center justify-between gap-1.5 px-1.5">
          {/* left actions */}
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8 shrink-0 rounded-md text-[var(--muted-text)] hover:bg-[var(--row-hover)] hover:text-[var(--ink)]"
              aria-label="Attach file"
              onClick={composer.onPickFiles}
            >
              <Paperclip className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 min-w-0 gap-1 rounded-md px-2 text-[12.5px] font-medium text-[var(--ink)] hover:bg-[var(--row-hover)]"
                >
                  <Shield className="size-3.5 shrink-0 text-[var(--muted-text)]" />
                  <span className="max-w-[8rem] truncate sm:max-w-none">{composer.permissionLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 rounded-md">
                <DropdownMenuLabel>권한 정책</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={composer.selectedPermission}
                  onValueChange={composer.onSelectPermission}
                >
                  {composer.permissionOptions.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* right actions */}
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden items-center gap-1 rounded-full bg-[var(--canvas-soft)] px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-[var(--muted-text)] sm:inline-flex">
              ctx {composer.tokenDial.percent}%
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 min-w-0 gap-1 rounded-md px-2 text-[12.5px] font-medium text-[var(--ink)] hover:bg-[var(--row-hover)]"
                >
                  <Brain className="size-3.5 shrink-0 text-[var(--muted-text)]" />
                  <span className="max-w-[7rem] truncate sm:max-w-[10rem]">{composer.modelLabel}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[24rem] w-72 overflow-y-auto rounded-md">
                <DropdownMenuLabel>Reasoning</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={composer.selectedEffort}
                  onValueChange={composer.onSelectEffort}
                >
                  {composer.efforts.map((effort) => (
                    <DropdownMenuRadioItem key={effort} value={effort}>{effort}</DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Model</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={composer.selectedModel}
                  onValueChange={composer.onSelectModel}
                >
                  {composer.models.map((model: any) => (
                    <DropdownMenuRadioItem key={model.id || model.model} value={model.model || model.id}>
                      {model.displayName || model.model || model.id}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="submit"
              size="icon"
              aria-label={composer.stopInsteadOfSend ? "Stop" : "Send"}
              disabled={composer.uploadingAttachments}
              className={cn(
                "ml-0.5 h-11 w-11 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] transition-colors hover:bg-[var(--primary-strong)] sm:h-8 sm:w-8",
                composer.stopInsteadOfSend &&
                  "bg-[var(--status-error)] text-white hover:bg-[color-mix(in_srgb,var(--status-error)_88%,black)]",
              )}
            >
              {composer.stopInsteadOfSend ? <Square className="size-3.5" /> : <Send className="size-3.5" />}
            </Button>
          </div>
        </div>

        {composer.thread ? (
          <div className="mx-auto mt-1.5 flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-1 text-[11px] text-[var(--muted-text)]">
            <span className="text-[var(--muted-text-soft)]">PROJECT</span>
            <span className="font-medium text-[var(--ink)]">{composer.selectedProject?.name || "Local"}</span>
            <span className="text-[var(--muted-text-soft)]">·</span>
            <span>로컬 Codex 세션</span>
            {composer.branches?.branches?.length ? (
              <>
                <span className="text-[var(--muted-text-soft)]">·</span>
                <Select
                  value={composer.branches.current || ""}
                  onValueChange={composer.onCheckoutBranch}
                >
                  <SelectTrigger className="h-6 gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-[var(--ink)] shadow-none hover:bg-[var(--row-hover)] focus:ring-0">
                    <SelectValue placeholder="Branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {composer.branches.branches.map((branch: any) => (
                      <SelectItem key={branch.name} value={branch.name}>{branch.name}</SelectItem>
                    ))}
                    <SelectItem value="__create__">New branch...</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
          </div>
        ) : null}

        <input
          ref={composer.fileInputRef}
          id="file-input"
          type="file"
          hidden
          multiple
          onChange={composer.onFilesSelected}
        />
      </form>
    </div>
  )
}

