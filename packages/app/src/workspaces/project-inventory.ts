import type { LocalProject } from "@/shell/state/layout"
import { pathKey } from "./path-key"

// Server metadata is sufficient for discovery; do not acquire a directory store for every known project.
export function projectInventory(opened: LocalProject[], known: LocalProject[], closed: string[]) {
  const paths = new Set([...opened.map((project) => project.worktree), ...closed].map(pathKey))

  return [...opened, ...known.filter((project) => !paths.has(pathKey(project.worktree)))]
}
