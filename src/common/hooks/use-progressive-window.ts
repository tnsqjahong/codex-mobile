import { useCallback, useEffect, useMemo, useState } from "react"

type WindowDirection = "head" | "tail"

interface ProgressiveWindowOptions {
  initialCount?: number
  step?: number
  resetKey?: string | number | null
  direction?: WindowDirection
}

export interface ProgressiveWindow<T> {
  visibleItems: T[]
  visibleCount: number
  hiddenBefore: number
  hiddenAfter: number
  canShowMore: boolean
  showMore: () => void
  showAll: () => void
}

export function useProgressiveWindow<T>(
  items: readonly T[],
  {
    initialCount = 80,
    step = 40,
    resetKey = null,
    direction = "tail",
  }: ProgressiveWindowOptions = {},
): ProgressiveWindow<T> {
  const [visibleCount, setVisibleCount] = useState(initialCount)

  useEffect(() => {
    setVisibleCount(initialCount)
  }, [initialCount, resetKey])

  useEffect(() => {
    if (visibleCount > items.length && items.length <= initialCount) {
      setVisibleCount(initialCount)
    }
  }, [initialCount, items.length, visibleCount])

  const boundedCount = Math.min(items.length, Math.max(initialCount, visibleCount))
  const hidden = Math.max(0, items.length - boundedCount)
  const hiddenBefore = direction === "tail" ? hidden : 0
  const hiddenAfter = direction === "head" ? hidden : 0

  const visibleItems = useMemo(() => {
    if (!hidden) return items.slice()
    return direction === "tail" ? items.slice(hidden) : items.slice(0, boundedCount)
  }, [boundedCount, direction, hidden, items])

  const showMore = useCallback(() => {
    setVisibleCount((current) => Math.min(items.length, current + step))
  }, [items.length, step])

  const showAll = useCallback(() => {
    setVisibleCount(items.length)
  }, [items.length])

  return {
    visibleItems,
    visibleCount: boundedCount,
    hiddenBefore,
    hiddenAfter,
    canShowMore: hidden > 0,
    showMore,
    showAll,
  }
}
