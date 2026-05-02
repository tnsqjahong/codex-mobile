import { mobileSelectors } from "@/domains/mobile/runtime/controller"

export function useFilteredThreads(state: Record<string, any>): any[] {
  const threads: any[] = state.threads || []
  const query = String(state.threadSearch || "").trim().toLowerCase()
  if (!query) return threads
  const result: any[] = []
  for (const thread of threads) {
    const haystack = `${thread.name || ""} ${thread.title || ""} ${thread.preview || ""} ${mobileSelectors.formatThreadStatus(thread.status)}`.toLowerCase()
    if (haystack.includes(query)) result.push(thread)
  }
  return result
}
