import { createMemo, type Accessor } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { HOME_SESSION_LIMIT, mergeHomeSessionIndex, retainHomeSessions } from "./index"
import { homeSessionsQuery } from "./queries"

export function createRecentSessionIndex(
  context: Accessor<ServerCtx | undefined>,
  connection: Accessor<ServerConnection.Any | undefined>,
) {
  const load = useQuery(() => {
    const ctx = context()

    return {
      ...homeSessionsQuery(connection(), ctx),
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
    }
  })

  return {
    load,
    sessions: createMemo(() => {
      const ctx = context()

      if (!ctx || !connection()) return []

      return retainHomeSessions(
        ctx.data.session.apply(
          mergeHomeSessionIndex(load.isPending ? [] : (load.data?.() ?? []), ctx.data.session.list()),
        ),
        HOME_SESSION_LIMIT,
        Date.now(),
      )
    }),
  }
}
