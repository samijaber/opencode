import { createMemo, type Accessor } from "solid-js"
import { skipToken, useQuery } from "@tanstack/solid-query"
import type { SessionInfo } from "@opencode/client/promise"
import type { ServerCtx } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { HOME_SESSION_LIMIT, loadHomeSessionIndex, mergeHomeSessionIndex, retainHomeSessions } from "./index"

// Home and the sidebar share a query cache and the same live removal/archival overlay.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export function createRecentSessionIndex(
  context: Accessor<ServerCtx | undefined>,
  connection: Accessor<ServerConnection.Any | undefined>,
) {
  const load = useQuery(() => {
    const ctx = context()

    return {
      queryKey: ["home-sessions", connection()] as const,
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
      queryFn: ctx
        ? ({ signal }) => loadHomeSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal)
        : skipToken,
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
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
