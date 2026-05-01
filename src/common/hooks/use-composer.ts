import { useRef, type ChangeEvent, type FormEvent, type RefObject } from "react"

import {
  mobileController,
  mobileSelectors,
  patchState,
} from "@/domains/mobile/runtime/controller"

const DEFAULT_EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh"]

export type TokenDial = { total: number; contextWindow: number; percent: number }

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

function deriveEfforts(state: Record<string, any>): readonly string[] {
  const model = (state.models || []).find(
    (item: any) => item.model === state.selectedModel || item.id === state.selectedModel,
  )
  const list: string[] = (model?.supportedReasoningEfforts || []).map(
    (item: any) => item.reasoningEffort,
  )
  return list.length ? list : DEFAULT_EFFORTS
}

function deriveTokenDial(state: Record<string, any>): TokenDial {
  const usage = state.tokenUsage?.tokenUsage || state.tokenUsage
  const total = Number(
    usage?.total?.totalTokens ||
      usage?.totalTokens ||
      usage?.total_tokens ||
      usage?.tokens ||
      0,
  )
  const contextWindow = Number(
    usage?.contextWindow ||
      usage?.context_window ||
      state.modelConfig?.contextWindow ||
      0,
  )
  const percent = contextWindow
    ? Math.min(100, Math.round((total / contextWindow) * 100))
    : 0
  return { total, contextWindow, percent }
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

  const efforts = deriveEfforts(state)
  const tokenDial = deriveTokenDial(state)
  const hasDraft = hasDraftValue(state)
  const stopInsteadOfSend = mobileSelectors.isThreadBusy() && !hasDraft
  const permissionOptions = mobileSelectors.permissionOptions() as PermissionOption[]
  const permissionLabel = derivePermissionLabel(state.selectedPermission)
  const modelLabel =
    state.selectedModel || state.modelConfig?.model || "default"

  return {
    fileInputRef,
    draftText: state.draftText || "",
    attachments: state.attachments || [],
    efforts,
    models: state.models || [],
    tokenDial,
    hasDraft,
    stopInsteadOfSend,
    uploadingAttachments: Boolean(state.uploadingAttachments),
    permissionOptions,
    permissionLabel,
    modelLabel,
    selectedPermission: state.selectedPermission || "",
    selectedEffort: state.selectedEffort || "",
    selectedModel: state.selectedModel || state.modelConfig?.model || "",
    thread: state.thread ?? null,
    selectedProject: state.selectedProject ?? null,
    branches: state.branches ?? null,
    onSubmit(event) {
      event.preventDefault()
      void submitComposer(state, stopInsteadOfSend)
    },
    onPickFiles() {
      fileInputRef.current?.click()
    },
    onFilesSelected(event) {
      const files = Array.from(event.target.files || [])
      event.currentTarget.value = ""
      if (files.length) void mobileController.uploadAttachments(files)
    },
    onDraftChange(value) {
      patchState({ draftText: value })
    },
    onRemoveAttachment(id) {
      patchState({
        attachments: (state.attachments || []).filter(
          (item: any) => item.id !== id,
        ),
      })
    },
    onSelectPermission(value) {
      patchState({ selectedPermission: value })
      localStorage.setItem("codexMobilePermission", value)
    },
    onSelectEffort(value) {
      patchState({ selectedEffort: value })
      localStorage.setItem("codexMobileEffort", value)
    },
    onSelectModel(value) {
      patchState({ selectedModel: value })
      localStorage.setItem("codexMobileModel", value)
    },
    onCheckoutBranch(value) {
      if (value === "__create__") {
        const branch = prompt("New branch name", "")
        if (branch) void mobileController.checkoutBranch(branch, true)
        return
      }
      void mobileController.checkoutBranch(value)
    },
  }
}
