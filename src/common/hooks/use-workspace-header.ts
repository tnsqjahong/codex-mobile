export type WorkspaceHeader = {
  title: string
  projectName: string
  changesCount: number
}

export function useWorkspaceHeader(state: Record<string, any>): WorkspaceHeader {
  const title =
    state.thread?.name ||
    state.thread?.preview ||
    state.selectedProject?.name ||
    "Codex Mobile"
  return {
    title,
    projectName: state.selectedProject?.name || "",
    changesCount: state.changes?.summary?.filesChanged ?? 0,
  }
}
