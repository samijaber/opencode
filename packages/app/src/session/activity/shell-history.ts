import { Schema } from "effect"
import { createEffect, onCleanup, untrack } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { shellActivity } from "./model"

const History = Persistence.struct({
  items: Persistence.array(
    Schema.Struct({
      id: Schema.String,
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
  // Shell.list is a live inventory, not history. Remember observed commands across phone reloads,
  // then reconcile missing live entries with Shell.get. Never persist command output.
  const [history, setHistory, , ready] = persisted(
    Persist.serverGlobal(sdk.scope, `session:${sessionID}:activity-shells-v1`),
    History,
    { items: [] },
  )
  const remember = (items: typeof History.Type.items) => {
    const merged = [...new Map([...history.items, ...items].map((item) => [item.id, item])).values()]
    const live = merged.filter((item) => item.status === "running")
    const recent = merged
      .filter((item) => item.status !== "running")
      .sort((a, b) => (b.completed ?? b.started) - (a.completed ?? a.started))
      .slice(0, 32)
    setHistory("items", [...live, ...recent])
  }
  createEffect(() => {
    if (!ready()) return
    const live = ids().flatMap((id) => data.shell.listBySession(id).map((shell) => shellActivity(shell, id)))
    if (live.length) untrack(() => remember(live))
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
    async sync() {
      await Promise.all(
        history.items
          .filter((item) => (item.status === "running" || item.status === "unknown") && !data.shell.get(item.id))
          .map(async (item) => {
            const result = await sdk.api.shell
              .get({ id: item.id, location: data.session.get(item.sessionID)?.location })
              .catch(() => undefined)
            // Commands can be evicted or lost on server restart. Missing is not success.
            remember([result ? shellActivity(result.data, item.sessionID) : { ...item, status: "unknown" }])
          }),
      )
    },
  }
}
