export type ComposerTokenKind = "skill" | "slash" | "mention"

export type ComposerTokenSymbol = "$" | "/" | "@"

export interface ComposerToken {
  kind: ComposerTokenKind
  symbol: ComposerTokenSymbol
  query: string
  start: number
  end: number
}

export type SlashCommandAction =
  | "compact"
  | "fork"
  | "settings"
  | "changes"
  | "new"

export interface SlashCommand {
  name: string
  description: string
  action: SlashCommandAction
  requiresThread?: boolean
}

const TOKEN_RE = /(^|\s)([$@/])([^\s$@/]*)$/

export function parseComposerToken(value: string, caret: number): ComposerToken | null {
  const before = value.slice(0, Math.max(0, caret))
  const match = before.match(TOKEN_RE)
  if (!match) return null
  const symbol = match[2] as ComposerTokenSymbol
  const query = match[3]
  return {
    kind: symbol === "$" ? "skill" : symbol === "@" ? "mention" : "slash",
    symbol,
    query,
    start: caret - query.length - 1,
    end: caret,
  }
}

export interface SpliceResult {
  value: string
  caret: number
}

export function spliceToken(value: string, token: ComposerToken, replacement: string): SpliceResult {
  const before = value.slice(0, token.start)
  const after = value.slice(token.end)
  const next = `${before}${replacement}${after}`
  return { value: next, caret: before.length + replacement.length }
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "compact", description: "현재 thread context를 압축합니다.", action: "compact", requiresThread: true },
  { name: "fork", description: "현재 thread를 새 thread로 fork합니다.", action: "fork", requiresThread: true },
  { name: "changes", description: "현재 변경 파일을 확인합니다.", action: "changes", requiresThread: true },
  { name: "new", description: "현재 프로젝트에서 새 채팅을 시작합니다.", action: "new" },
  { name: "status", description: "계정, 모델, MCP, skill 상태를 엽니다.", action: "settings" },
  { name: "skills", description: "설치된 skill을 확인합니다.", action: "settings" },
  { name: "mcp", description: "MCP 서버 상태를 확인합니다.", action: "settings" },
]

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return SLASH_COMMANDS.slice(0, 10)
  return SLASH_COMMANDS.filter((command) => {
    const haystack = `${command.name} ${command.description}`.toLowerCase()
    return haystack.includes(needle)
  }).slice(0, 10)
}

export function filterSkills<T extends { name?: string; description?: string }>(skills: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return skills.slice(0, 8)
  return skills
    .filter((skill) => `${skill.name || ""} ${skill.description || ""}`.toLowerCase().includes(needle))
    .slice(0, 8)
}
