export type ChangeFile = {
  path: string
  status: string
  additions?: number
  deletions?: number
  diff?: string
  [key: string]: any
}

export type ChangesView = {
  summary: { filesChanged: number; additions: number; deletions: number }
  turnDiff: { diff: string; updatedAt?: number } | null
  files: ChangeFile[]
  loading: boolean
  error: string
}

export function useChangesFiles(state: Record<string, any>): ChangesView {
  const changes = state.changes
  const summary = {
    filesChanged: changes?.summary?.filesChanged ?? 0,
    additions: changes?.summary?.additions ?? 0,
    deletions: changes?.summary?.deletions ?? 0,
  }
  const turnDiff = changes?.turnDiff?.diff ? changes.turnDiff : null

  const files: ChangeFile[] = []
  const rawFiles: any[] = changes?.files || []
  for (const file of rawFiles) {
    const path = file.path || file.filePath || file.name || ""
    if (!path) continue
    files.push({
      ...file,
      path,
      status: file.status || file.changeType || "M",
    })
  }

  return {
    summary,
    turnDiff,
    files,
    loading: Boolean(state.changesLoading),
    error: state.changesError || "",
  }
}
