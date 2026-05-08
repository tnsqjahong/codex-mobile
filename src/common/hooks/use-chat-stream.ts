import { useMemo } from "react"

import { mobileSelectors } from "@/domains/mobile/runtime/controller"

export type ChatStreamItem = {
  key: string
  item: any
  turn: any
  isLastInTurn: boolean
}

export type ChatStream = {
  items: ChatStreamItem[]
  approvals: any[]
  isBusy: boolean
  hasThread: boolean
  startPending: any | null
}

function threadItemsSignature(turns: any[] | undefined): string {
  if (!turns?.length) return "0"
  let itemCount = 0
  let lastItem: any = null
  let lastTurn: any = null
  for (const turn of turns) {
    const items = turn?.items || []
    itemCount += items.length
    if (items.length) {
      lastTurn = turn
      lastItem = items[items.length - 1]
    }
  }
  return [
    turns.length,
    itemCount,
    lastTurn?.id || "",
    lastItem?.id || "",
    mobileSelectors.extractText(lastItem).length,
    lastItem?.status || lastItem?.outcome || "",
  ].join(":")
}

function approvalsSignature(approvals: Map<any, any> | undefined): string {
  if (!approvals?.size) return "0"
  return [...approvals.entries()]
    .map(([key, value]) => `${key}:${value?.status || value?.state || ""}`)
    .join("|")
}

export function useChatStream(state: Record<string, any>): ChatStream {
  const turns = state.thread?.turns
  const itemsKey = threadItemsSignature(turns)
  const approvalKey = approvalsSignature(state.approvals)

  const items: ChatStreamItem[] = useMemo(() => {
    const nextItems: ChatStreamItem[] = []
    if (turns) {
      for (let ti = 0; ti < turns.length; ti++) {
        const turn = turns[ti]
        const turnItems = turn?.items || []
        for (let ii = 0; ii < turnItems.length; ii++) {
          const item = turnItems[ii]
          const fallbackKey = `${ti}-${ii}-${item?.type ?? "x"}`
          nextItems.push({
            key: item?.id ?? fallbackKey,
            item,
            turn,
            isLastInTurn: ii === turnItems.length - 1,
          })
        }
      }
    }
    return nextItems
  }, [itemsKey, state.version, turns])

  const approvals = useMemo(
    () => state.approvals?.values ? Array.from(state.approvals.values()) : [],
    [approvalKey, state.approvals, state.version],
  )

  return {
    items,
    approvals,
    isBusy: mobileSelectors.isThreadBusy(),
    hasThread: Boolean(state.thread),
    startPending: state.thread ? null : state.startPendingMessage ?? null,
  }
}
