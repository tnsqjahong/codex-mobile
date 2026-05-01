import { ArrowLeft, Bell, Bot, PlugZap, Puzzle, Sparkles } from "lucide-react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/common/ui/card"
import { ScrollArea } from "@/common/ui/scroll-area"

function collectPlugins(plugins: any) {
  return (plugins?.marketplaces || []).flatMap((market: any) => market.plugins || [])
}

function renderRateLimit(rateLimits: any) {
  const primary = rateLimits?.rateLimits?.primary
  if (!primary) return null
  return <p className="text-sm text-muted-foreground">Usage {primary.usedPercent}%{primary.resetsAt ? ` · resets ${new Intl.DateTimeFormat("ko", { dateStyle: "short", timeStyle: "short" }).format(new Date(primary.resetsAt))}` : ""}</p>
}

function formatAccount(account: any, requiresOpenaiAuth: boolean) {
  if (account?.type === "chatgpt") return `${account.email} · ${account.planType}`
  if (account?.type) return account.type
  return requiresOpenaiAuth ? "Login required" : "No account details"
}

function CollectionCard({ title, icon: Icon, items }: { title: string; icon: any; items: string[] }) {
  return (
    <Card className="border-border bg-card shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-primary" /> {title}</CardTitle>
        <CardDescription>{items.length} items</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.length ? items.slice(0, 30).map((item) => (
          <div key={item} className="rounded-2xl border border-border bg-[var(--canvas-soft)] px-3 py-2 text-sm text-muted-foreground">{item}</div>
        )) : <p className="text-sm text-muted-foreground">No items.</p>}
      </CardContent>
    </Card>
  )
}

export function SettingsPane({ state }: { state: Record<string, any> }) {
  const settings = state.settings || {}
  const account = settings.account?.account
  const plugins = collectPlugins(settings.plugins).map((plugin: any) => plugin.interface?.displayName || plugin.name)
  const skills = (settings.skills?.data || []).flatMap((entry: any) => entry.skills || []).map((skill: any) => skill.name || skill.metadata?.name)
  const apps = (settings.apps?.data || []).map((item: any) => item.name || item.id)
  const mcpServers = (settings.mcpServers?.mcpServers || settings.mcpServers?.data || []).map((item: any) => item.name || item.id || item.serverName)
  const automations = (settings.automations?.data || []).map((item: any) => `${item.name}${item.status ? ` · ${item.status}` : ""}`)

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="rounded-full" onClick={() => mobileController.backToWorkspace()}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <div className="font-semibold tracking-tight">Settings</div>
            <p className="text-xs text-muted-foreground">Account, plugins, skills, automations</p>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 px-3 pb-10 pt-3">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-10">
          <Card className="border-border bg-card shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4 text-primary" /> Account</CardTitle>
              <CardDescription>{formatAccount(account, settings.account?.requiresOpenaiAuth)}</CardDescription>
            </CardHeader>
            <CardContent>{renderRateLimit(settings.rateLimits)}</CardContent>
          </Card>

          <Card className="border-border bg-card shadow-none">
            <CardHeader>
              <CardTitle className="text-base">Runtime</CardTitle>
              <CardDescription>Model {settings.config?.summary?.model || "default"} · Reasoning {settings.config?.summary?.effort || "default"}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Approval {settings.config?.summary?.approvalPolicy || "default"} · Sandbox {settings.config?.summary?.sandboxMode || "workspace"}</p>
            </CardContent>
          </Card>

          <Card className="border-border bg-card shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="size-4 text-primary" /> Notifications</CardTitle>
              <CardDescription>{state.notificationsEnabled ? "이 브라우저 세션에서 알림이 활성화되어 있습니다." : "작업 완료/승인 요청 알림을 브라우저에서 받습니다."}</CardDescription>
            </CardHeader>
            <CardContent>
              {"Notification" in window ? (
                <Button variant="secondary" onClick={() => void mobileController.enableNotifications()} disabled={state.notificationsEnabled}>
                  알림 켜기
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">This browser does not support notifications.</p>
              )}
            </CardContent>
          </Card>

          <CollectionCard title="Plugins" icon={Puzzle} items={plugins} />
          <CollectionCard title="Skills" icon={Sparkles} items={skills} />
          <CollectionCard title="Apps" icon={PlugZap} items={apps} />
          <CollectionCard title="MCP Servers" icon={PlugZap} items={mcpServers} />
          <CollectionCard title="Automations" icon={Sparkles} items={automations} />
        </div>
      </ScrollArea>
    </div>
  )
}
