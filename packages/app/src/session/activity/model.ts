import type { FormInfo, PermissionRequest, SessionInfo, ShellInfo } from "@opencode/client/promise"
import { sessionTreeIDs } from "../requests/session-request-tree"

export type ActivityItem = {
  id: string
  sessionID: string
  parentID?: string
  type: "session" | "shell"
  label: string
  status: "running" | "permission" | "question" | "completed" | "failed" | "interrupted" | "unknown"
  started: number
  completed?: number
}

export function sessionActivity(input: {
  sessionID: string
  sessions: SessionInfo[]
  status: (id: string) => "running" | "idle"
  shells: (id: string) => ShellInfo[]
  history?: readonly ActivityItem[]
  permissions: (id: string) => PermissionRequest[] | undefined
  forms: (id: string) => FormInfo[] | undefined
}) {
  const ids = sessionTreeIDs(input.sessions, input.sessionID)
  const family = new Set(ids)
  const sessions = input.sessions.filter((session) => family.has(session.id))
  const items: ActivityItem[] = sessions.flatMap((session): ActivityItem[] => {
    const permission = input.permissions(session.id)?.length
    const question = input
      .forms(session.id)
      ?.some((form) => form.metadata?.kind === "question" || form.metadata?.kind === "websearch.provider")
    // The main agent already has its own working indicator. Include it here only when it needs the user.
    if (session.id === input.sessionID && !permission && !question) return []
    return [
      {
        id: session.id,
        sessionID: session.id,
        parentID: session.parentID,
        type: "session",
        label: session.title ?? session.id,
        status: permission
          ? "permission"
          : question
            ? "question"
            : input.status(session.id) === "running"
              ? "running"
              : session.outcome === "succeeded"
                ? "completed"
                : (session.outcome ?? "unknown"),
        started: session.time.created,
        completed: session.time.idle,
      },
    ]
  })
  ids.forEach((sessionID) => {
    input.shells(sessionID).forEach((shell) => {
      items.push(shellActivity(shell, sessionID))
    })
  })
  // Shell inventory and child sessions are authoritative, so a detached tool's completed call is never counted twice.
  const unique = [
    ...new Map(
      [...(input.history ?? []).filter((item) => family.has(item.sessionID)), ...items].map((item) => [item.id, item]),
    ).values(),
  ]
  const recent = unique
    .filter((item) => ["completed", "failed", "interrupted"].includes(item.status))
    .sort((a, b) => (b.completed ?? b.started) - (a.completed ?? a.started))
    .slice(0, 8)
  return {
    attention: [
      ...unique.filter((item) => item.status === "permission" || item.status === "question"),
      ...recent.filter((item) => item.status === "failed"),
    ],
    running: unique.filter((item) => item.status === "running"),
    unknown: unique.filter((item) => item.status === "unknown"),
    recent: recent.filter((item) => item.status !== "failed"),
  }
}

export function shellActivity(
  shell: Pick<ShellInfo, "id" | "command" | "status" | "exit" | "time">,
  sessionID: string,
) {
  return {
    id: shell.id,
    sessionID,
    parentID: sessionID,
    type: "shell" as const,
    label: shell.command,
    status:
      shell.status === "running"
        ? ("running" as const)
        : shell.status === "killed"
          ? ("interrupted" as const)
          : shell.status === "timeout" || (shell.exit !== undefined && shell.exit !== 0)
            ? ("failed" as const)
            : shell.exit === 0
              ? ("completed" as const)
              : ("unknown" as const),
    started: shell.time.started,
    completed: shell.time.completed,
  }
}
