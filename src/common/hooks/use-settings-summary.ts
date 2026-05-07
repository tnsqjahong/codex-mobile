import { useMemo } from "react"

export interface SettingsSummaryView {
  account: { primaryLabel: string; planLabel: string | null; loggedIn: boolean }
  usage: {
    windows: Array<{
      id: string
      label: string
      usedPercent: number | null
      remainingPercent: number | null
      resetsAt: string | null
    }>
    nextResetLabel: string | null
    error: string | null
  }
  runtime: {
    model: string
    effort: string
    approval: string
    sandbox: string
    modelDescription: string | null
    effortDescription: string | null
  }
  plugins: string[]
  skills: string[]
  apps: string[]
  mcpServers: string[]
  automations: string[]
  supportsNotifications: boolean
}

const RESETS_FORMATTER = new Intl.DateTimeFormat("ko", {
  dateStyle: "short",
  timeStyle: "short",
})

function pickAccountSummary(settings: Record<string, any>): SettingsSummaryView["account"] {
  const account = settings.account?.account
  const requiresOpenaiAuth = Boolean(settings.account?.requiresOpenaiAuth)
  if (account?.type === "chatgpt") {
    return {
      primaryLabel: account.email || "ChatGPT account",
      planLabel: account.planType || null,
      loggedIn: true,
    }
  }
  if (account?.type) {
    return { primaryLabel: account.type, planLabel: null, loggedIn: true }
  }
  return {
    primaryLabel: requiresOpenaiAuth ? "Login required" : "No account",
    planLabel: null,
    loggedIn: false,
  }
}

function pickUsageSummary(settings: Record<string, any>): SettingsSummaryView["usage"] {
  const root = settings.rateLimits?.rateLimits
  const windows = [
    normalizeUsageWindow("primary", "5h 세션", root?.primary),
    normalizeUsageWindow("secondary", "주간", root?.secondary),
  ].filter((entry) => entry.usedPercent !== null || entry.resetsAt)
  const nextResetMs = windows
    .map((entry) => entry.resetsAtMs)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b)[0]

  return {
    windows: windows.map(({ resetsAtMs, ...entry }) => entry),
    nextResetLabel: nextResetMs ? RESETS_FORMATTER.format(new Date(nextResetMs)) : null,
    error: settings.rateLimits?.error || null,
  }
}

function normalizeUsageWindow(id: string, fallbackLabel: string, source: any) {
  const usedPercent = normalizePercent(source?.usedPercent)
  const resetMs = normalizeTimestampMs(source?.resetsAt)
  return {
    id,
    label: labelForWindow(source?.windowDurationMins) || fallbackLabel,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    resetsAt: resetMs ? RESETS_FORMATTER.format(new Date(resetMs)) : null,
    resetsAtMs: resetMs,
  }
}

function normalizePercent(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return null
  return Math.max(0, Math.min(100, Math.round(numberValue)))
}

function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === "number") return value > 1_000_000_000_000 ? value : value * 1000
  if (typeof value === "string") {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return normalizeTimestampMs(numeric)
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function labelForWindow(windowDurationMins: unknown): string | null {
  const mins =
    typeof windowDurationMins === "number"
      ? windowDurationMins
      : typeof windowDurationMins === "string"
        ? Number(windowDurationMins)
        : NaN
  if (!Number.isFinite(mins) || mins <= 0) return null
  if (mins === 300) return "5h 세션"
  if (mins === 10080) return "주간"
  if (mins % 1440 === 0) return `${mins / 1440}일`
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${mins}분`
}

function modelValue(model: any): string {
  return model?.model || model?.id || ""
}

function displayModelName(state: Record<string, any>, value: string): string {
  const model = (state.models || []).find((item: any) => modelValue(item) === value)
  return model?.displayName || value || "default"
}

function pickRuntimeSummary(state: Record<string, any>): SettingsSummaryView["runtime"] {
  const settings = state.settings || {}
  const summary = settings.config?.summary || {}
  const configuredModel = summary.model || ""
  const configuredEffort = summary.effort || ""
  const activeModel = state.selectedModel || configuredModel || "default"
  const activeEffort = state.selectedEffort || configuredEffort || "default"
  return {
    model: displayModelName(state, activeModel),
    effort: activeEffort,
    approval: summary.approvalPolicy || "default",
    sandbox: summary.sandboxMode || "workspace",
    modelDescription: state.selectedModel
      ? `Codex Mobile override${configuredModel ? ` · 기본값 ${configuredModel}` : ""}`
      : null,
    effortDescription: state.selectedEffort
      ? `Codex Mobile override${configuredEffort ? ` · 기본값 ${configuredEffort}` : ""}`
      : null,
  }
}

function collectPlugins(plugins: any): string[] {
  return (plugins?.marketplaces || [])
    .flatMap((market: any) => market.plugins || [])
    .map((plugin: any) => plugin.interface?.displayName || plugin.name)
    .filter(Boolean)
}

function collectSkills(skills: any): string[] {
  return (skills?.data || [])
    .flatMap((entry: any) => entry.skills || [])
    .map((skill: any) => skill.name || skill.metadata?.name)
    .filter(Boolean)
}

function collectApps(apps: any): string[] {
  return (apps?.data || []).map((item: any) => item.name || item.id).filter(Boolean)
}

function collectMcpServers(mcp: any): string[] {
  const list = mcp?.mcpServers || mcp?.data || []
  return list.map((item: any) => item.name || item.id || item.serverName).filter(Boolean)
}

function collectAutomations(automations: any): string[] {
  return (automations?.data || [])
    .map((item: any) => `${item.name}${item.status ? ` · ${item.status}` : ""}`)
    .filter(Boolean)
}

export function useSettingsSummary(state: Record<string, any>): SettingsSummaryView {
  const settings = state.settings || {}
  const accountRef = settings.account
  const rateLimitsRef = settings.rateLimits
  const configRef = settings.config
  const pluginsRef = settings.plugins
  const skillsRef = settings.skills
  const appsRef = settings.apps
  const mcpServersRef = settings.mcpServers
  const automationsRef = settings.automations

  const account = useMemo(() => pickAccountSummary(settings), [accountRef])
  const usage = useMemo(() => pickUsageSummary(settings), [rateLimitsRef])
  const selectedModelRef = state.selectedModel
  const selectedEffortRef = state.selectedEffort
  const modelsRef = state.models
  const runtime = useMemo(
    () => pickRuntimeSummary(state),
    [configRef, selectedModelRef, selectedEffortRef, modelsRef],
  )
  const plugins = useMemo(() => collectPlugins(pluginsRef), [pluginsRef])
  const skills = useMemo(() => collectSkills(skillsRef), [skillsRef])
  const apps = useMemo(() => collectApps(appsRef), [appsRef])
  const mcpServers = useMemo(() => collectMcpServers(mcpServersRef), [mcpServersRef])
  const automations = useMemo(() => collectAutomations(automationsRef), [automationsRef])
  const supportsNotifications = useMemo(
    () => typeof window !== "undefined" && "Notification" in window,
    [],
  )

  return {
    account,
    usage,
    runtime,
    plugins,
    skills,
    apps,
    mcpServers,
    automations,
    supportsNotifications,
  }
}
