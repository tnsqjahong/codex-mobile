import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"

/**
 * Sticky-bottom scroll hook for streaming chat surfaces.
 *
 * Behavior:
 *  - When the user is within `threshold` px of the bottom, treat them as "anchored"
 *    and auto-scroll on every content change so streaming tokens stay visible.
 *  - When the user scrolls up past the threshold, disable auto-follow until they
 *    return to the bottom (or click `scrollToBottom`).
 *  - Returns `isAtBottom` so callers can show a "jump to bottom" affordance.
 *
 * The `contentKey` should change whenever content height may have changed
 * (typically the items length + last-item text length). It drives the
 * `useLayoutEffect` that performs the auto-scroll BEFORE paint, preventing
 * flicker.
 */
export interface StickToBottomView {
  isAtBottom: boolean
  hasOverflow: boolean
  scrollToBottom: (smooth?: boolean) => void
  onScroll: () => void
}

interface UseStickToBottomArgs<T extends HTMLElement> {
  ref: RefObject<T | null>
  contentKey: unknown
  threshold?: number
}

const DEFAULT_THRESHOLD = 96

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

export function useStickToBottom<T extends HTMLElement>({
  ref,
  contentKey,
  threshold = DEFAULT_THRESHOLD,
}: UseStickToBottomArgs<T>): StickToBottomView {
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasOverflow, setHasOverflow] = useState(false)

  // Latest "is at bottom" decision, used inside the layout effect without
  // forcing the effect to depend on the state value (rerender-defer-reads).
  const stickyRef = useRef(true)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const overflow = el.scrollHeight - el.clientHeight > 1
    const atBottom = !overflow || distanceFromBottom(el) <= threshold
    setHasOverflow(overflow)
    setIsAtBottom(atBottom)
    stickyRef.current = atBottom
  }, [ref, threshold])

  // Measure once on mount + whenever the container resizes (e.g. composer grows).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, measure])

  // Auto-scroll on content change, BEFORE paint, only if currently anchored.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (stickyRef.current) {
      // jumping by setting scrollTop (no smooth) keeps streaming feel snappy.
      el.scrollTop = el.scrollHeight
    }
    // Re-measure after the DOM mutated to refresh hasOverflow / isAtBottom.
    measure()
  }, [contentKey, ref, measure])

  const onScroll = useCallback(() => {
    measure()
  }, [measure])

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const el = ref.current
      if (!el) return
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      })
      stickyRef.current = true
      setIsAtBottom(true)
    },
    [ref],
  )

  return { isAtBottom, hasOverflow, scrollToBottom, onScroll }
}
