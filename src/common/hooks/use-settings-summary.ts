import { useMemo } from "react"

export interface SettingsSummaryView {
  account: { primaryLabel: string; planLabel: string | null; loggedIn: boolean }
  usage: { percent: number | null; resetsAt: string | null }
  runtime: { model: string; effort: string; approval: string; sandbox: string }
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
  const primary = settings.rateLimits?.rateLimits?.primary
  if (!primary) return { percent: null, resetsAt: null }
  const percent = Number.isFinite(primary.usedPercent) ? Math.round(primary.usedPercent) : null
  const resetsAt = primary.resetsAt ? RESETS_FORMATTER.format(new Date(primary.resetsAt)) : null
  return { percent, resetsAt }
}

function pickRuntimeSummary(settings: Record<string, any>): SettingsSummaryView["runtime"] {
  const summary = settings.config?.summary || {}
  return {
    model: summary.model || "default",
    effort: summary.effort || "default",
    approval: summary.approvalPolicy || "default",
    sandbox: summary.sandboxMode || "workspace",
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
  const runtime = useMemo(() => pickRuntimeSummary(settings), [configRef])
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
