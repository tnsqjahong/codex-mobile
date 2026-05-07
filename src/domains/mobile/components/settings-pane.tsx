import { type ReactNode, useState } from "react"
import {
  ArrowLeft,
  Bell,
  Bot,
  ChevronDown,
  Layers,
  Puzzle,
  Server,
  Sparkles,
  Workflow,
} from "lucide-react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { ScrollArea } from "@/common/ui/scroll-area"
import { cn } from "@/common/lib/utils"
import { useSettingsSummary } from "@/common/hooks/use-settings-summary"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="px-1 pb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--muted-text)]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-2xl border border-[var(--hairline-soft)] bg-[var(--surface-warm)] divide-y divide-[var(--hairline-soft)]">
        {children}
      </div>
    </section>
  )
}

function StaticRow({
  label,
  description,
  value,
}: {
  label: string
  description?: string
  value?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-[var(--ink-strong)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-text)]">{description}</div>
        ) : null}
      </div>
      {value !== undefined ? (
        <div className="shrink-0 self-center text-[13px] text-[var(--muted-text)]">{value}</div>
      ) : null}
    </div>
  )
}

function UsageRow({
  usageWindow,
}: {
  usageWindow: {
    label: string
    usedPercent: number | null
    remainingPercent: number | null
    resetsAt: string | null
  }
}) {
  const parts = [
    usageWindow.usedPercent !== null ? `사용 ${usageWindow.usedPercent}%` : null,
    usageWindow.resetsAt ? `다음 업데이트 ${usageWindow.resetsAt}` : null,
  ].filter(Boolean)

  return (
    <StaticRow
      label={`${usageWindow.label} 사용량`}
      description={parts.length ? parts.join(" · ") : undefined}
      value={usageWindow.remainingPercent !== null ? `${usageWindow.remainingPercent}% 남음` : undefined}
    />
  )
}

function ActionRow({
  label,
  description,
  action,
}: {
  label: string
  description?: string
  action: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-[var(--ink-strong)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-text)]">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}

function CollectionRow({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof Puzzle
  label: string
  items: string[]
}) {
  const [open, setOpen] = useState(false)
  const empty = items.length === 0
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={empty}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--row-hover)] disabled:cursor-default disabled:opacity-70"
      >
        <Icon className="size-4 text-[var(--muted-text)]" />
        <span className="flex-1 text-[13.5px] text-[var(--ink-strong)]">{label}</span>
        <span className="text-[12px] tabular-nums text-[var(--muted-text)]">{items.length}</span>
        {empty ? null : (
          <ChevronDown
            className={cn(
              "size-4 text-[var(--muted-text)] transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>
      {open && !empty ? (
        <div className="border-t border-[var(--hairline-soft)] bg-[var(--canvas-soft)] px-2 py-1.5">
          <ul className="max-h-72 overflow-y-auto">
            {items.slice(0, 100).map((item) => (
              <li
                key={item}
                className="rounded-md px-2 py-1 text-[12.5px] text-[var(--muted-text)]"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function SettingsPane({ state }: { state: Record<string, any> }) {
  const view = useSettingsSummary(state)

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header
        className="sticky top-0 z-10 border-b border-[var(--hairline-soft)] bg-[var(--canvas)]"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-12 w-full max-w-3xl items-center gap-2 px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-md hover:bg-[var(--row-hover)]"
            aria-label="Back"
            onClick={() => mobileController.backToWorkspace()}
          >
            <ArrowLeft className="size-4 text-[var(--muted-text)]" />
          </Button>
          <h1 className="text-[14px] font-semibold tracking-tight text-[var(--ink-strong)]">
            Settings
          </h1>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-5 pb-12 sm:px-4">
          <div className="flex items-center gap-3 rounded-2xl border border-[var(--hairline-soft)] bg-[var(--surface-warm)] px-4 py-4">
            <div className="grid size-10 place-items-center rounded-full bg-[var(--canvas-soft)]">
              <Bot className="size-5 text-[var(--muted-text)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-[var(--ink-strong)]">
                {view.account.primaryLabel}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {view.account.planLabel ? (
                  <span className="rounded-full border border-[var(--hairline)] bg-[var(--canvas-soft)] px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-[var(--muted-text)]">
                    {view.account.planLabel}
                  </span>
                ) : null}
                <span className="text-[11.5px] text-[var(--muted-text)]">
                  {view.account.loggedIn ? "Connected" : "Not signed in"}
                </span>
              </div>
            </div>
          </div>

          <Section title="Usage">
            {view.usage.windows.length ? (
              view.usage.windows.map((usageWindow) => (
                <div key={usageWindow.id}>
                  <UsageRow usageWindow={usageWindow} />
                </div>
              ))
            ) : (
              <StaticRow
                label="사용량 정보"
                description={view.usage.error || "Codex App Server에서 사용량 정보를 아직 받지 못했습니다."}
              />
            )}
            {view.usage.nextResetLabel ? (
              <StaticRow
                label="다음 업데이트"
                description="가장 먼저 초기화되는 사용량 창 기준"
                value={view.usage.nextResetLabel}
              />
            ) : null}
          </Section>

          <Section title="Runtime">
            <StaticRow label="Model" description={view.runtime.modelDescription || undefined} value={view.runtime.model} />
            <StaticRow label="Reasoning" description={view.runtime.effortDescription || undefined} value={view.runtime.effort} />
            <StaticRow label="Approval" value={view.runtime.approval} />
            <StaticRow label="Sandbox" value={view.runtime.sandbox} />
          </Section>

          <Section title="Notifications">
            <ActionRow
              label="브라우저 알림"
              description={
                view.supportsNotifications
                  ? state.notificationsEnabled
                    ? "이 브라우저 세션에서 알림이 활성화되어 있습니다."
                    : "작업 완료/승인 요청 알림을 브라우저에서 받습니다."
                  : "이 브라우저는 알림을 지원하지 않습니다."
              }
              action={
                view.supportsNotifications ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void mobileController.enableNotifications()}
                    disabled={Boolean(state.notificationsEnabled)}
                    className="h-8 rounded-md px-3 text-[12.5px]"
                  >
                    <Bell className="size-3.5" />
                    {state.notificationsEnabled ? "On" : "Enable"}
                  </Button>
                ) : null
              }
            />
          </Section>

          <Section title="Installed">
            <CollectionRow icon={Puzzle} label="Plugins" items={view.plugins} />
            <CollectionRow icon={Sparkles} label="Skills" items={view.skills} />
            <CollectionRow icon={Layers} label="Apps" items={view.apps} />
            <CollectionRow icon={Server} label="MCP Servers" items={view.mcpServers} />
            <CollectionRow icon={Workflow} label="Automations" items={view.automations} />
          </Section>
        </div>
      </ScrollArea>
    </div>
  )
}
