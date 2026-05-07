export type ChangeFile = {
  path: string
  status: string
  repo?: string
  repoPath?: string
  displayPath?: string
  additions?: number
  deletions?: number
  diff?: string
  truncatedDiff?: boolean
  diffUnavailableReason?: string
  [key: string]: any
}

export type ChangesView = {
  summary: { filesChanged: number; additions: number; deletions: number }
  turnDiff: { diff: string; updatedAt?: number } | null
  files: ChangeFile[]
  repositories: any[]
  canCommit: boolean
  workspace: boolean
  truncatedFiles: number
  truncatedRepositories: number
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
      displayPath: file.displayPath || path,
      status: file.status || file.changeType || "M",
    })
  }

  return {
    summary,
    turnDiff,
    files,
    repositories: changes?.repositories || [],
    canCommit: changes?.canCommit !== false && !changes?.workspace,
    workspace: Boolean(changes?.workspace),
    truncatedFiles: changes?.truncatedFiles ?? 0,
    truncatedRepositories: changes?.truncatedRepositories ?? 0,
    loading: Boolean(state.changesLoading),
    error: state.changesError || changes?.error || "",
  }
}
