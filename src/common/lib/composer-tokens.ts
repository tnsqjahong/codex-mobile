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
  | "model"
  | "permissions"
  | "settings"
  | "context"
  | "changes"
  | "new"
  | "refresh"
  | "archive"

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
  { name: "model", description: "모델과 reasoning 선택 메뉴를 엽니다.", action: "model" },
  { name: "reasoning", description: "reasoning effort 선택 메뉴를 엽니다.", action: "model" },
  { name: "permissions", description: "권한 정책 선택 메뉴를 엽니다.", action: "permissions" },
  { name: "changes", description: "현재 변경 파일을 확인합니다.", action: "changes", requiresThread: true },
  { name: "diff", description: "현재 변경 diff를 확인합니다.", action: "changes", requiresThread: true },
  { name: "review", description: "변경 사항 검토 화면을 엽니다.", action: "changes", requiresThread: true },
  { name: "refresh", description: "현재 thread snapshot과 실시간 연결을 다시 동기화합니다.", action: "refresh", requiresThread: true },
  { name: "context", description: "현재 context 사용량을 다시 측정합니다.", action: "context", requiresThread: true },
  { name: "archive", description: "현재 thread를 Recents에서 제거합니다.", action: "archive", requiresThread: true },
  { name: "new", description: "현재 프로젝트에서 새 채팅을 시작합니다.", action: "new" },
  { name: "settings", description: "모바일 Codex 상태와 설정을 엽니다.", action: "settings" },
  { name: "status", description: "계정, 모델, MCP, skill 상태를 엽니다.", action: "settings" },
  { name: "skills", description: "설치된 skill을 확인합니다.", action: "settings" },
  { name: "prompts", description: "사용 가능한 prompt/agent 구성을 확인합니다.", action: "settings" },
  { name: "agents", description: "로컬 agent 구성을 확인합니다.", action: "settings" },
  { name: "mcp", description: "MCP 서버 상태를 확인합니다.", action: "settings" },
  { name: "plugins", description: "설치된 plugin 상태를 확인합니다.", action: "settings" },
  { name: "apps", description: "연결된 app 상태를 확인합니다.", action: "settings" },
]

const SLASH_COMMAND_SEARCH = SLASH_COMMANDS.map((command) => ({
  command,
  haystack: `${command.name} ${command.description}`.toLowerCase(),
}))

export function filterSlashCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return SLASH_COMMANDS.slice(0, 24)
  const result: SlashCommand[] = []
  for (const { command, haystack } of SLASH_COMMAND_SEARCH) {
    if (!haystack.includes(needle)) continue
    result.push(command)
    if (result.length >= 24) break
  }
  return result
}

export function filterSkills<T extends { name?: string; description?: string }>(skills: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return skills.slice(0, 24)
  const result: T[] = []
  for (const skill of skills) {
    if (!`${skill.name || ""} ${skill.description || ""}`.toLowerCase().includes(needle)) continue
    result.push(skill)
    if (result.length >= 24) break
  }
  return result
}
