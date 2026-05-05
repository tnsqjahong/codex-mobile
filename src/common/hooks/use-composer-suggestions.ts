import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react"

import { mobileController, patchState } from "@/domains/mobile/runtime/controller"
import {
  filterSkills,
  filterSlashCommands,
  parseComposerToken,
  spliceToken,
  type ComposerToken,
  type SlashCommand,
} from "@/common/lib/composer-tokens"

const MENTION_DEBOUNCE_MS = 150

export type SuggestionItem =
  | { kind: "skill"; id: string; title: string; subtitle: string; name: string; path: string }
  | { kind: "slash"; id: string; title: string; subtitle: string; command: SlashCommand }
  | { kind: "agent"; id: string; title: string; subtitle: string; name: string; path: string }
  | { kind: "file"; id: string; title: string; subtitle: string; name: string; path: string; root: string }
  | { kind: "plugin"; id: string; title: string; subtitle: string; name: string }
  | { kind: "app"; id: string; title: string; subtitle: string; name: string }

export interface ComposerSuggestionsView {
  open: boolean
  token: ComposerToken | null
  items: SuggestionItem[]
  selectedIndex: number
  loading: boolean
  empty: boolean
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onSelectionChange: () => void
  onSelectIndex: (index: number) => void
  onSelectItem: (item: SuggestionItem) => void
  dismiss: () => void
}

interface UseComposerSuggestionsArgs {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draftText: string
  skills: readonly any[]
  composerMentions: readonly any[]
  cwd: string
  hasThread: boolean
  threadId: string | null
}

interface MentionsResult {
  agents?: any[]
  files?: any[]
  plugins?: any[]
  apps?: any[]
}

function tokensEqual(a: ComposerToken | null, b: ComposerToken | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.kind === b.kind && a.query === b.query && a.start === b.start && a.end === b.end
}

function buildMentionItems(result: MentionsResult): SuggestionItem[] {
  const out: SuggestionItem[] = []
  for (const agent of result.agents || []) {
    const name = String(agent.name || "")
    if (!name) continue
    out.push({
      kind: "agent",
      id: `agent-${name}`,
      title: `@${name}`,
      subtitle: agent.description || agent.model || "Agent",
      name,
      path: agent.path || "",
    })
  }
  for (const file of result.files || []) {
    const name = String(file.name || "")
    const path = String(file.absolutePath || "")
    if (!name || !path) continue
    out.push({
      kind: "file",
      id: `file-${path}`,
      title: `@${name}`,
      subtitle: file.path || "",
      name,
      path,
      root: file.root || "",
    })
  }
  for (const app of result.apps || []) {
    const name = String(app.name || app.id || "")
    if (!name) continue
    out.push({
      kind: "app",
      id: `app-${app.id || name}`,
      title: `@${name}`,
      subtitle: app.description || "App",
      name,
    })
  }
  for (const plugin of result.plugins || []) {
    const name = String(plugin.displayName || plugin.name || "")
    if (!name) continue
    out.push({
      kind: "plugin",
      id: `plugin-${plugin.id || name}`,
      title: `@${name}`,
      subtitle: plugin.description || "Plugin",
      name,
    })
  }
  return out.slice(0, 18)
}

function dispatchSlash(
  command: SlashCommand,
  hasThread: boolean,
  threadId: string | null,
): void {
  if (command.action === "compact" || command.action === "fork") {
    if (hasThread) void mobileController.runThreadAction(command.action)
    return
  }
  if (command.action === "settings") {
    void mobileController.loadSettings()
    return
  }
  if (command.action === "changes") {
    patchState({ activeTab: "changes" })
    if (threadId) void mobileController.loadChanges(threadId)
    return
  }
  if (command.action === "new") {
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
}

export function useComposerSuggestions({
  textareaRef,
  draftText,
  skills,
  composerMentions,
  cwd,
  hasThread,
  threadId,
}: UseComposerSuggestionsArgs): ComposerSuggestionsView {
  const [token, setToken] = useState<ComposerToken | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mentionsResult, setMentionsResult] = useState<MentionsResult>({})
  const [loading, setLoading] = useState(false)

  // Keep latest mentions in a ref so onSelectItem stays referentially stable
  // (rerender-defer-reads: composerMentions is only read inside the callback).
  const mentionsRef = useRef(composerMentions)
  mentionsRef.current = composerMentions

  const skillItems: SuggestionItem[] = useMemo(() => {
    if (!token || token.kind !== "skill") return []
    return filterSkills(skills, token.query).map<SuggestionItem>((skill: any) => ({
      kind: "skill",
      id: `skill-${skill.name}`,
      title: `$${skill.name}`,
      subtitle: skill.description || "",
      name: String(skill.name || ""),
      path: String(skill.path || skill.source || ""),
    }))
  }, [token, skills])

  const slashItems: SuggestionItem[] = useMemo(() => {
    if (!token || token.kind !== "slash") return []
    return filterSlashCommands(token.query)
      .filter((command) => !command.requiresThread || hasThread)
      .map<SuggestionItem>((command) => ({
        kind: "slash",
        id: `slash-${command.name}`,
        title: `/${command.name}`,
        subtitle: command.description,
        command,
      }))
  }, [token, hasThread])

  const mentionItems: SuggestionItem[] = useMemo(() => {
    if (!token || token.kind !== "mention") return []
    return buildMentionItems(mentionsResult)
  }, [token, mentionsResult])

  const items =
    token?.kind === "skill"
      ? skillItems
      : token?.kind === "slash"
        ? slashItems
        : token?.kind === "mention"
          ? mentionItems
          : []

  const detectToken = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const next = parseComposerToken(ta.value, ta.selectionStart || 0)
    setToken((current) => (tokensEqual(current, next) ? current : next))
  }, [textareaRef])

  // Token can change with text edits OR caret moves; keep both in sync.
  useEffect(() => {
    detectToken()
  }, [draftText, detectToken])

  // Reset selection when items list identity flips (token kind/query change).
  useEffect(() => {
    setSelectedIndex(0)
  }, [token?.kind, token?.query])

  // Mention search: debounced, cancellable via AbortController.
  // Primitive deps (rerender-dependencies) — using token.query string, not the token object.
  const mentionQuery = token?.kind === "mention" ? token.query : null
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionsResult({})
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = window.setTimeout(() => {
      mobileController
        .searchMentions(cwd, mentionQuery, controller.signal)
        .then((data: MentionsResult) => setMentionsResult(data || {}))
        .catch((error: unknown) => {
          if ((error as Error)?.name === "AbortError") return
          setMentionsResult({})
        })
        .finally(() => setLoading(false))
    }, MENTION_DEBOUNCE_MS)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [mentionQuery, cwd])

  const dismiss = useCallback(() => {
    setToken(null)
  }, [])

  const onSelectItem = useCallback(
    (item: SuggestionItem) => {
      const ta = textareaRef.current
      if (!ta || !token) return

      if (item.kind === "slash") {
        const { value, caret } = spliceToken(ta.value, token, "")
        patchState({ draftText: value })
        ta.focus()
        ta.setSelectionRange(caret, caret)
        setToken(null)
        dispatchSlash(item.command, hasThread, threadId)
        return
      }

      if (item.kind === "skill") {
        const replacement = `$${item.name} `
        const { value, caret } = spliceToken(ta.value, token, replacement)
        const next = [
          ...mentionsRef.current,
          {
            id: `skill-${item.name}-${Date.now()}`,
            kind: "skill",
            name: item.name,
            path: item.path,
          },
        ]
        patchState({ draftText: value, composerMentions: next })
        ta.focus()
        ta.setSelectionRange(caret, caret)
        setToken(null)
        return
      }

      if (item.kind === "file") {
        const replacement = `@${item.name} `
        const { value, caret } = spliceToken(ta.value, token, replacement)
        const next = [
          ...mentionsRef.current,
          {
            id: `mention-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: "file",
            name: item.name,
            path: item.path,
            root: item.root,
          },
        ]
        patchState({ draftText: value, composerMentions: next })
        ta.focus()
        ta.setSelectionRange(caret, caret)
        setToken(null)
        return
      }

      // agent / plugin / app — bridge does not register these as turn input mentions,
      // so we only insert the textual marker.
      const replacement = `@${item.name} `
      const { value, caret } = spliceToken(ta.value, token, replacement)
      patchState({ draftText: value })
      ta.focus()
      ta.setSelectionRange(caret, caret)
      setToken(null)
    },
    [token, textareaRef, hasThread, threadId],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.nativeEvent.isComposing) return
      if (!token || items.length === 0) return

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          setSelectedIndex((current) => (current + 1) % items.length)
          return
        case "ArrowUp":
          event.preventDefault()
          setSelectedIndex((current) => (current - 1 + items.length) % items.length)
          return
        case "Enter":
        case "Tab": {
          event.preventDefault()
          const item = items[selectedIndex] ?? items[0]
          if (item) onSelectItem(item)
          return
        }
        case "Escape":
          event.preventDefault()
          setToken(null)
          return
        default:
          return
      }
    },
    [token, items, selectedIndex, onSelectItem],
  )

  const onSelectIndex = useCallback((index: number) => {
    setSelectedIndex(index)
  }, [])

  return {
    open: Boolean(token),
    token,
    items,
    selectedIndex: items.length ? Math.min(selectedIndex, items.length - 1) : 0,
    loading,
    empty: Boolean(token) && !loading && items.length === 0,
    onKeyDown,
    onSelectionChange: detectToken,
    onSelectIndex,
    onSelectItem,
    dismiss,
  }
}
