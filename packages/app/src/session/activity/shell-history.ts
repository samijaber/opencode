import { Schema } from "effect"
import { createEffect, onCleanup, untrack } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { shellActivity } from "./model"
import { sessionBackgroundHistory } from "../requests/background"

const History = Persistence.struct({
  checkpoint: Schema.optional(Schema.String),
  items: Persistence.array(
    Schema.Struct({
      id: Schema.String,
      partID: Schema.optional(Schema.String),
      sessionID: Schema.String,
      parentID: Schema.String,
      type: Schema.Literal("shell"),
      label: Schema.String,
      status: Schema.Literals(["running", "completed", "failed", "interrupted", "unknown"]),
      started: Schema.Finite,
      completed: Schema.optional(Schema.Finite),
    }),
  ),
})

export function createActivityShellHistory(sessionID: string, ids: () => string[]) {
  const data = useData()
  const sdk = useServerSDK()
  const abort = new AbortController()
  const pending: { sync?: Promise<void> } = {}
  onCleanup(() => abort.abort())
  // Shell.list is a live inventory, not history. Remember observed commands across phone reloads,
  // then reconcile missing live entries with Shell.get. Never persist command output.
  const [history, setHistory, , ready] = persisted(
    Persist.serverGlobal(sdk.scope, `session:${sessionID}:activity-shells-v1`),
    History,
    { items: [] },
  )
  const remember = (items: typeof History.Type.items) => {
    const merged = new Map(history.items.map((item) => [item.id, item]))
    items.forEach((item) => merged.set(item.id, { ...merged.get(item.id), ...item }))
    const live = [...merged.values()].filter((item) => item.status === "running" || item.status === "unknown")
    const recent = [...merged.values()]
      .filter((item) => item.status !== "running" && item.status !== "unknown")
      .sort((a, b) => (b.completed ?? b.started) - (a.completed ?? a.started))
      .slice(0, 32)
    setHistory("items", [...live, ...recent])
  }
  createEffect(() => {
    if (!ready()) return
    const live = ids().flatMap((id) => data.shell.listBySession(id).map((shell) => shellActivity(shell, id)))
    if (live.length) untrack(() => remember(live))
  })
  createEffect(() => {
    if (!ready()) return
    const parsed = sessionBackgroundHistory(data.session.message.list(sessionID))
    untrack(() => {
      const known = new Set(history.items.map((item) => item.id))
      const discovered = parsed.shells.flatMap((item) =>
        known.has(item.id)
          ? []
          : [
              {
                ...item,
                sessionID,
                parentID: sessionID,
                status: "unknown" as const,
              },
            ],
      )
      const completed = history.items.flatMap((item) => {
        const outcome = parsed.outcomes.get(item.id) ?? parsed.outcomes.get(item.partID ?? item.id)
        return outcome && (item.status !== outcome.status || item.completed !== outcome.at)
          ? [{ ...item, status: outcome.status, completed: outcome.at }]
          : []
      })
      if (discovered.length || completed.length) remember([...discovered, ...completed])
    })
  })
  onCleanup(
    sdk.event.on("shell.exited", (event) => {
      const item = history.items.find((item) => item.id === event.data.id)
      if (!item) return
      remember([
        shellActivity(
          {
            id: item.id,
            command: item.label,
            status: event.data.status,
            exit: event.data.exit,
            time: { started: item.started, completed: event.created },
          },
          item.sessionID,
        ),
      ])
    }),
  )
  return {
    ready,
    items: () => history.items,
    sync() {
      return (pending.sync ??= reconcile().finally(() => {
        pending.sync = undefined
      }))
    },
  }

  async function reconcile() {
    // Inventory is process-local. Desktop also discovers detached shells from tool records, which
    // survive inventory loss. Page independently of the visible transcript, retaining only task metadata.
    // The checkpoint makes subsequent reconnects incremental rather than rereading long conversations.
    const records = new Map<string, (typeof History.Type.items)[number]>()
    const outcomes = new Map<string, { status: "completed" | "failed" | "interrupted" | "unknown"; at: number }>()
    const scan: { cursor?: string; checkpoint?: string } = { checkpoint: history.checkpoint }
    do {
      const page = await sdk.api.message.list(
        { sessionID, limit: 100, ...(scan.cursor ? { cursor: scan.cursor } : { order: "desc" as const }) },
        { signal: abort.signal },
      )
      if (!scan.cursor) scan.checkpoint = page.data[0]?.id ?? history.checkpoint
      const boundary = page.data.findIndex((message) => message.id === history.checkpoint)
      const parsed = sessionBackgroundHistory(boundary === -1 ? page.data : page.data.slice(0, boundary + 1))
      parsed.shells.forEach((item) =>
        records.set(item.id, {
          ...item,
          sessionID,
          parentID: sessionID,
          status: "unknown",
        }),
      )
      parsed.outcomes.forEach((outcome, id) => {
        if ((outcomes.get(id)?.at ?? -Infinity) < outcome.at) outcomes.set(id, outcome)
      })
      if (boundary !== -1) break
      scan.cursor = page.cursor.next ?? undefined
    } while (scan.cursor)

    // Live delivery may have overtaken the paginated read. Its completion facts take precedence too.
    sessionBackgroundHistory(data.session.message.list(sessionID)).outcomes.forEach((outcome, id) => {
      if ((outcomes.get(id)?.at ?? -Infinity) < outcome.at) outcomes.set(id, outcome)
    })
    const existing = new Map(history.items.map((item) => [item.id, { ...records.get(item.id), ...item }]))
    remember(
      [...new Map([...records, ...existing]).values()].map((item) => {
        const outcome = outcomes.get(item.id) ?? outcomes.get(item.partID ?? item.id)
        return outcome ? { ...item, status: outcome.status, completed: outcome.at } : item
      }),
    )
    setHistory("checkpoint", scan.checkpoint)
    await Promise.all(
      history.items
        .filter((item) => (item.status === "running" || item.status === "unknown") && !data.shell.get(item.id))
        .map(async (item) => {
          const result = await sdk.api.shell
            .get({ id: item.id, location: data.session.get(item.sessionID)?.location }, { signal: abort.signal })
            .catch(() => undefined)
          if (abort.signal.aborted) return
          const current = history.items.find((entry) => entry.id === item.id)
          if (!current || (current.status !== "running" && current.status !== "unknown")) return
          // Commands can be evicted or lost on server restart. Missing is not success.
          remember([result ? shellActivity(result.data, item.sessionID) : { ...item, status: "unknown" }])
        }),
    )
  }
}
