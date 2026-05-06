import { mobileSelectors } from "@/domains/mobile/runtime/controller"

export type ChatStreamItem = { key: string; item: any }

export type ChatStream = {
  items: ChatStreamItem[]
  approvals: any[]
  isBusy: boolean
  hasThread: boolean
  startPending: any | null
}

export function useChatStream(state: Record<string, any>): ChatStream {
  const turns = state.thread?.turns
  const items: ChatStreamItem[] = []
  if (turns) {
    for (let ti = 0; ti < turns.length; ti++) {
      const turn = turns[ti]
      const turnItems = turn?.items || []
      for (let ii = 0; ii < turnItems.length; ii++) {
        const item = turnItems[ii]
        const fallbackKey = `${ti}-${ii}-${item?.type ?? "x"}`
        items.push({ key: item?.id ?? fallbackKey, item })
      }
    }
  }

  const approvals = state.approvals?.values
    ? Array.from(state.approvals.values())
    : []

  return {
    items,
    approvals,
    isBusy: mobileSelectors.isThreadBusy(),
    hasThread: Boolean(state.thread),
    startPending: state.thread ? null : state.startPendingMessage ?? null,
  }
}
