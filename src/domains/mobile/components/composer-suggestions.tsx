import { AppWindow, FileText, Loader2, Puzzle, Slash, Sparkles, UserRound } from "lucide-react"

import { cn } from "@/common/lib/utils"
import type { ComposerSuggestionsView, SuggestionItem } from "@/common/hooks/use-composer-suggestions"

const ICON_BY_KIND = {
  skill: Sparkles,
  slash: Slash,
  agent: UserRound,
  file: FileText,
  plugin: Puzzle,
  app: AppWindow,
} as const

const HEADING_BY_KIND = {
  skill: "Skills",
  slash: "Slash commands",
  mention: "Agents · Files · Apps · Plugins",
} as const

function headingFor(view: ComposerSuggestionsView): string {
  if (!view.token) return ""
  return HEADING_BY_KIND[view.token.kind]
}

function emptyHintFor(view: ComposerSuggestionsView): string {
  if (!view.token) return ""
  if (view.token.kind === "skill") return "설치된 skill이 없습니다."
  if (view.token.kind === "slash") return "일치하는 명령이 없습니다."
  return "검색 결과가 없습니다."
}

export function ComposerSuggestions({ view }: { view: ComposerSuggestionsView }) {
  if (!view.open || !view.token) return null

  return (
    <div
      role="listbox"
      aria-label={headingFor(view)}
      className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[50dvh] overflow-y-auto rounded-2xl border border-[var(--hairline)] bg-[var(--surface-warm)] p-1.5 text-[var(--ink)] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.65)]"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted-text)]">
        <span>{headingFor(view)}</span>
        {view.loading ? <Loader2 className="size-3 animate-spin text-[var(--muted-text)]" /> : null}
      </div>

      {view.empty ? (
        <div className="px-3 py-2 text-[12.5px] text-[var(--muted-text)]">{emptyHintFor(view)}</div>
      ) : null}

      <ul className="space-y-0.5">
        {view.items.map((item, index) => {
          const Icon = ICON_BY_KIND[item.kind]
          const active = index === view.selectedIndex
          return (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => view.onSelectIndex(index)}
                onClick={() => view.onSelectItem(item)}
                className={cn(
                  "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  active ? "bg-[var(--row-selected)]" : "hover:bg-[var(--row-hover)]",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-3.5 shrink-0",
                    active ? "text-[var(--ink-strong)]" : "text-[var(--muted-text)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink-strong)]">
                    {renderTitle(item)}
                  </span>
                  {item.subtitle ? (
                    <span className="mt-0.5 block truncate text-[11.5px] text-[var(--muted-text)]">
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function renderTitle(item: SuggestionItem): string {
  return item.title
}
