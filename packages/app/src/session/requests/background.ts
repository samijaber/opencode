import type { SessionInfo, SessionMessageAssistant, SessionMessageInfo, ShellInfo } from "@opencode/client/promise"
import { createMemo } from "solid-js"

type Task =
  | { id: string; type: "subagent"; label: string; agent?: string }
  | { id: string; type: "shell"; label: string }

export function sessionBackgroundHistory(messages: SessionMessageInfo[]) {
  const completed = new Set<string>()
  const outcomes = new Map<string, { status: "completed" | "failed" | "interrupted" | "unknown"; at: number }>()
  const subagents: { id: string; type: "subagent"; label: string; agent: string | undefined }[] = []
  const shells: {
    partID: string
    task: { id: string; partID: string; type: "shell"; label: string; started: number }
  }[] = []

  const assistant = messages.reduce<SessionMessageAssistant | undefined>((latest, message) => {
    if (message.type === "synthetic") {
      if (message.metadata?.source === "subagent" && typeof message.metadata.childID === "string")
        completed.add(message.metadata.childID)

      if (message.metadata?.source === "shell") {
        const metadata = message.metadata
        const outcome = {
          status:
            metadata.state === "cancelled" || metadata.signal
              ? ("interrupted" as const)
              : metadata.state === "error" ||
                  metadata.timeout ||
                  (typeof metadata.exit === "number" && metadata.exit !== 0)
                ? ("failed" as const)
                : metadata.exit === 0
                  ? ("completed" as const)
                  : ("unknown" as const),
          at: message.time.created,
        }
        for (const id of [metadata.shellID, metadata.jobID]) {
          if (typeof id !== "string") continue
          completed.add(id)
          if ((outcomes.get(id)?.at ?? -Infinity) < outcome.at) outcomes.set(id, outcome)
        }
      }

      return latest
    }

    if (message.type !== "assistant") return latest
    message.content.forEach((part) => {
      if (part.type !== "tool" || (part.name !== "subagent" && part.name !== "shell")) return

      if (part.state.status !== "completed" || part.state.metadata?.status !== "running") return

      if (part.name === "subagent") {
        const sessionID = part.state.metadata.sessionID

        if (typeof sessionID !== "string") return
        const description = part.state.input.description
        const agent = part.state.input.agent
        subagents.push({
          id: sessionID,
          type: "subagent",
          label: typeof description === "string" ? description : sessionID,
          agent: typeof agent === "string" ? agent : undefined,
        })

        return
      }

      const shellID = part.state.metadata.shellID
      const command = part.state.input.command
      shells.push({
        partID: part.id,
        task: {
          id: typeof shellID === "string" ? shellID : part.id,
          partID: part.id,
          type: "shell",
          label: typeof command === "string" ? command : part.id,
          started: part.time.ran ?? part.time.created,
        },
      })
    })

    return message.time.completed === undefined ? message : latest
  }, undefined)

  return {
    completed,
    outcomes,
    // Completion notices can identify the shell or its original tool call.
    subagents: subagents.filter((task) => !completed.has(task.id)),
    shells: shells
      .filter((item) => !completed.has(item.partID) && !completed.has(item.task.id))
      .map((item) => item.task),
    blocking:
      assistant?.content.flatMap((part) => {
        if (part.type !== "tool" || part.state.status !== "running") return []

        if (part.name !== "shell" && part.name !== "subagent") return []
        const value = part.name === "shell" ? part.state.metadata.shellID : part.state.metadata.sessionID
        const label = part.name === "shell" ? part.state.input.command : part.state.input.description

        return [
          {
            type: part.name as "shell" | "subagent",
            partID: part.id,
            id: typeof value === "string" ? value : undefined,
            label: typeof label === "string" ? label : undefined,
          },
        ]
      }) ?? [],
  }
}

export function createSessionBackground(input: {
  sessionID: () => string | undefined
  messages: (id: string) => SessionMessageInfo[]
  sessions: () => SessionInfo[]
  status: (id: string) => "idle" | "running"
  shells: () => ShellInfo[]
}) {
  const history = createMemo(() => {
    const id = input.sessionID()
    return sessionBackgroundHistory(id ? input.messages(id) : [])
  })

  const blocking = createMemo(() => history().blocking)

  const tasks = createMemo(() => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    const active = input.sessions().flatMap((info) => {
      if (info?.parentID !== id) return []

      if (input.status(info.id) === "idle") return []

      if (
        current.blocking.some(
          (item) => item.type === "subagent" && (item.id === info.id || (!!item.label && info.title === item.label)),
        )
      )
        return []

      return [{ id: info.id, type: "subagent" as const, label: info.title ?? info.id }]
    })

    const running = input.shells().flatMap((shell) => {
      if (shell.status !== "running" || shell.metadata.sessionID !== id) return []

      if (
        current.blocking.some(
          (item) => item.type === "shell" && (item.id === shell.id || (!!item.label && shell.command === item.label)),
        )
      )
        return []

      return [{ id: shell.id, type: "shell" as const, label: shell.command }]
    })

    return [
      ...new Map<string, Task>(
        [...current.subagents, ...active, ...current.shells, ...running].map((task) => [task.id, task]),
      ).values(),
    ]
  })

  return { blocking, tasks }
}
