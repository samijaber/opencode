import { createMemo, type Accessor } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import type { SessionInfo } from "@opencode/client/promise"
import {
  HOME_SESSION_LIMIT,
  HOME_SESSION_PAGE_LIMIT,
  mergeHomeSessionIndex,
  parseHomeSessionIndex,
  retainHomeSessions,
} from "./index"

export function createRecentSessionIndex(
  context: Accessor<ServerCtx | undefined>,
  connection: Accessor<ServerConnection.Any | undefined>,
) {
  const load = useQuery(() => {
    const ctx = context()

    return {
      queryKey: ["home-sessions", connection(), "history"] as const,
      retry: false,
      staleTime: 30_000,
      gcTime: Infinity,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: (sessions: SessionInfo[]) => () => sessions,
      // Home intentionally fetches one page upstream. The custom history must also reach older directories.
      queryFn: async ({ signal }) => {
        if (!ctx) return []
        const now = Date.now()
        let retained: SessionInfo[] = []
        let cursor: string | undefined

        for (;;) {
          const response = await ctx.sdk.api.session.list(
            { limit: HOME_SESSION_PAGE_LIMIT, order: "desc", parentID: null, cursor },
            { signal },
          )

          retained = retainHomeSessions(
            mergeHomeSessionIndex(retained, parseHomeSessionIndex(response.data)),
            HOME_SESSION_LIMIT,
            now,
          )

          if (!response.cursor.next || response.data.length < HOME_SESSION_PAGE_LIMIT) return retained
          cursor = response.cursor.next
        }
      },
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
