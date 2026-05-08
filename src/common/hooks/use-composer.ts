import { useCallback, useMemo, useRef, type ChangeEvent, type FormEvent, type RefObject } from "react"

import {
  mobileController,
  mobileSelectors,
  patchState,
} from "@/domains/mobile/runtime/controller"
import { formatModelLabel, modelDisplayName, modelValue } from "@/common/lib/model-label"

const DEFAULT_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh"]

export type TokenDial = {
  total: number
  contextWindow: number
  percent: number
  remaining: number | null
  hasUsage: boolean
  title: string
}

export type PermissionOption = { value: string; label: string }

export type ComposerView = {
  fileInputRef: RefObject<HTMLInputElement | null>
  draftText: string
  attachments: any[]
  efforts: readonly string[]
  models: any[]
  tokenDial: TokenDial
  hasDraft: boolean
  stopInsteadOfSend: boolean
  uploadingAttachments: boolean
  permissionOptions: PermissionOption[]
  permissionLabel: string
  modelLabel: string
  displayModelName: (model: any) => string
  selectedPermission: string
  selectedEffort: string
  selectedModel: string
  thread: any | null
  selectedProject: any | null
  branches: any | null
  onSubmit: (event: FormEvent) => void
  onPickFiles: () => void
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => void
  onDraftChange: (value: string) => void
  onRemoveAttachment: (id: string) => void
  onSelectPermission: (value: string) => void
  onSelectEffort: (value: string) => void
  onSelectModel: (value: string) => void
  onCheckoutBranch: (value: string) => void
}

function deriveEfforts(state: Record<string, any>, modelByValue: Map<string, any>): readonly string[] {
  const selectedModel = state.selectedModel || state.modelConfig?.model || ""
  const model = modelByValue.get(selectedModel)
  const list: string[] = (model?.supportedReasoningEfforts || []).map(
    (item: any) => item.reasoningEffort,
  )
  return list.length ? list : DEFAULT_EFFORTS
}

function numericValue(value: any): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value !== "string") return 0
  const trimmed = value.trim()
  if (!trimmed) return 0
  const direct = Number(trimmed)
  if (Number.isFinite(direct)) return direct
  const match = trimmed.toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmg])?$/)
  if (!match) return 0
  const base = Number(match[1])
  const multiplier = match[2] === "g" ? 1_000_000_000 : match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1
  return base * multiplier
}

function firstNumber(...values: any[]): number {
  for (const value of values) {
    const number = numericValue(value)
    if (Number.isFinite(number) && number > 0) return number
  }
  return 0
}

function sumNumbers(...values: any[]): number {
  return values.reduce((sum, value) => {
    const number = numericValue(value)
    return Number.isFinite(number) && number > 0 ? sum + number : sum
  }, 0)
}

function selectedModelRecord(state: Record<string, any>, modelByValue: Map<string, any>) {
  const selectedModel = state.selectedModel || state.modelConfig?.model || state.context?.config?.model || ""
  return modelByValue.get(selectedModel) || {}
}

function inferredModelContextWindow(state: Record<string, any>): number {
  const model = String(state.selectedModel || state.modelConfig?.model || state.context?.config?.model || "").toLowerCase()
  if (!model) return 0
  if (model.includes("gpt-5") || model.includes("codex")) return 400_000
  if (model.includes("gpt-4.1")) return 1_000_000
  if (model.includes("o3") || model.includes("o4")) return 200_000
  return 0
}

function deriveContextWindow(state: Record<string, any>, usage: any, modelByValue: Map<string, any>): number {
  const selected = selectedModelRecord(state, modelByValue)
  return firstNumber(
    usage?.modelContextWindow,
    usage?.contextWindow,
    usage?.context_window,
    state.context?.config?.modelContextWindow,
    state.context?.config?.contextWindow,
    state.context?.config?.modelAutoCompactTokenLimit,
    state.modelConfig?.modelContextWindow,
    state.modelConfig?.contextWindow,
    state.modelConfig?.modelAutoCompactTokenLimit,
    selected.modelContextWindow,
    selected.contextWindow,
    selected.contextWindowTokens,
    selected.context_window,
    selected.limits?.contextWindow,
    selected.modelAutoCompactTokenLimit,
    selected.limits?.modelAutoCompactTokenLimit,
    selected.limits?.autoCompactTokenLimit,
    inferredModelContextWindow(state),
  )
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function deriveTokenDial(state: Record<string, any>, modelByValue: Map<string, any>): TokenDial {
  const usage = state.tokenUsage?.tokenUsage || state.tokenUsage
  const total = usage?.total || null
  const totalTokens = firstNumber(
    total?.totalTokens,
    total?.tokens,
    total?.total_tokens,
    usage?.totalTokens,
    usage?.total_tokens,
    usage?.tokens,
  ) || sumNumbers(
    total?.inputTokens,
    total?.cachedInputTokens,
    total?.outputTokens,
    total?.reasoningOutputTokens,
    usage?.inputTokens,
    usage?.cachedInputTokens,
    usage?.outputTokens,
    usage?.reasoningOutputTokens,
    usage?.input_tokens,
    usage?.cached_input_tokens,
    usage?.output_tokens,
    usage?.reasoning_output_tokens,
  )
  const contextWindow = deriveContextWindow(state, usage, modelByValue)
  const hasUsage = totalTokens > 0
  const percent = contextWindow
    ? Math.min(100, Math.round((totalTokens / contextWindow) * 100))
    : 0
  const remaining = contextWindow ? Math.max(0, contextWindow - totalTokens) : null
  const title = !hasUsage
    ? "Codex context usage is not available for this thread yet"
    : remaining == null
    ? `${compactNumber(totalTokens)} tokens used in context`
    : `${compactNumber(totalTokens)} used, ${compactNumber(remaining)} left of ${compactNumber(contextWindow)}`
  return { total: totalTokens, contextWindow, percent, remaining, hasUsage, title }
}

function derivePermissionLabel(value: string): string {
  const opt = mobileSelectors
    .permissionOptions()
    .find((item: any) => item.value === value)
  return opt?.label || "기본 권한"
}

function hasDraftValue(state: Record<string, any>): boolean {
  return Boolean(
    String(state.draftText || "").trim() || (state.attachments || []).length,
  )
}

function findModel(state: Record<string, any>, value: string) {
  return (state.models || []).find((item: any) => modelValue(item) === value)
}

function indexModels(models: readonly any[]): Map<string, any> {
  const byValue = new Map<string, any>()
  for (const model of models) {
    const value = modelValue(model)
    if (value) byValue.set(value, model)
  }
  return byValue
}

function displayModelLabel(modelByValue: Map<string, any>, value: string): string {
  const model = modelByValue.get(value)
  return model ? modelDisplayName(model, value) : formatModelLabel(value || "default")
}

function supportedEffortsForModel(model: any): string[] {
  return (model?.supportedReasoningEfforts || [])
    .map((item: any) => item.reasoningEffort)
    .filter(Boolean)
}

async function submitComposer(state: Record<string, any>, stopInsteadOfSend: boolean): Promise<void> {
  if (stopInsteadOfSend) {
    await mobileController.interruptThread()
    return
  }
  const cwd = state.selectedProject?.cwd
  if (!cwd) return
  const text = String(state.draftText || "")
  const attachments = [...(state.attachments || [])]
  const mentions = [...(state.composerMentions || [])]

  if (!state.thread) {
    if (!text.trim() && !attachments.length && !mentions.length) return
    patchState({
      draftText: "",
      attachments: [],
      composerMentions: [],
      creatingThread: true,
      startPendingMessage: { text, attachments, mentions },
    })
    try {
      await mobileController.createThread(cwd, text, attachments, mentions)
    } finally {
      patchState({ creatingThread: false, startPendingMessage: null })
    }
    return
  }

  patchState({ draftText: "", attachments: [], composerMentions: [] })
  await mobileController.sendMessage(text, attachments, mentions)
}

export function useComposer(state: Record<string, any>): ComposerView {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const models = state.models || []
  const modelByValue = useMemo(() => indexModels(models), [models])
  const efforts = useMemo(() => deriveEfforts(state, modelByValue), [modelByValue, state.modelConfig?.model, state.selectedModel])
  const tokenDial = useMemo(
    () => deriveTokenDial(state, modelByValue),
    [modelByValue, state.context, state.modelConfig, state.selectedModel, state.tokenUsage],
  )
  const hasDraft = hasDraftValue(state)
  const stopInsteadOfSend = mobileSelectors.isThreadBusy() && !hasDraft
  const stopInsteadOfSendRef = useRef(stopInsteadOfSend)
  stopInsteadOfSendRef.current = stopInsteadOfSend
  const permissionOptions = mobileSelectors.permissionOptions() as PermissionOption[]
  const permissionLabel = derivePermissionLabel(state.selectedPermission)
  const activeModel = state.selectedModel || state.modelConfig?.model || ""
  const modelLabel = displayModelLabel(modelByValue, activeModel)

  const onSubmit = useCallback((event: FormEvent) => {
    event.preventDefault()
    void submitComposer(stateRef.current, stopInsteadOfSendRef.current)
  }, [])

  const onPickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.currentTarget.value = ""
    if (files.length) void mobileController.uploadAttachments(files)
  }, [])

  const onDraftChange = useCallback((value: string) => {
    patchState({ draftText: value })
  }, [])

  const onRemoveAttachment = useCallback((id: string) => {
    const current = stateRef.current
    patchState({
      attachments: (current.attachments || []).filter(
        (item: any) => item.id !== id,
      ),
    })
  }, [])

  const onSelectPermission = useCallback((value: string) => {
    patchState({ selectedPermission: value })
    localStorage.setItem("codexMobilePermission", value)
  }, [])

  const onSelectEffort = useCallback((value: string) => {
    patchState({ selectedEffort: value })
    localStorage.setItem("codexMobileEffort", value)
  }, [])

  const onSelectModel = useCallback((value: string) => {
    const current = stateRef.current
    const model = findModel(current, value)
    const supportedEfforts = supportedEffortsForModel(model)
    const nextEffort =
      supportedEfforts.length && !supportedEfforts.includes(current.selectedEffort)
        ? model?.defaultReasoningEffort || supportedEfforts[0] || ""
        : current.selectedEffort
    patchState({ selectedModel: value, selectedEffort: nextEffort || "" })
    localStorage.setItem("codexMobileModel", value)
    if (nextEffort) localStorage.setItem("codexMobileEffort", nextEffort)
    else localStorage.removeItem("codexMobileEffort")
  }, [])

  const onCheckoutBranch = useCallback((value: string) => {
    if (value === "__create__") {
      const branch = prompt("New branch name", "")
      if (branch) void mobileController.checkoutBranch(branch, true)
      return
    }
    void mobileController.checkoutBranch(value)
  }, [])

  return {
    fileInputRef,
    draftText: state.draftText || "",
    attachments: state.attachments || [],
    efforts,
    models,
    tokenDial,
    hasDraft,
    stopInsteadOfSend,
    uploadingAttachments: Boolean(state.uploadingAttachments),
    permissionOptions,
    permissionLabel,
    modelLabel,
    displayModelName: modelDisplayName,
    selectedPermission: state.selectedPermission || "",
    selectedEffort: state.selectedEffort || "",
    selectedModel: activeModel,
    thread: state.thread ?? null,
    selectedProject: state.selectedProject ?? null,
    branches: state.branches ?? null,
    onSubmit,
    onPickFiles,
    onFilesSelected,
    onDraftChange,
    onRemoveAttachment,
    onSelectPermission,
    onSelectEffort,
    onSelectModel,
    onCheckoutBranch,
  }
}
