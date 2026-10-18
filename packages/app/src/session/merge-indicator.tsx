import { Show } from "solid-js"
import { useQuery } from "@tanstack/solid-query"
import { useGlobal } from "@/runtime/server/runtime"
import type { ServerConnection } from "@/runtime/server/registry"
import { useLanguage } from "@/runtime/i18n/language"
import "./merge-indicator.css"

/** All session title surfaces share the same non-blocking query and cached server result. */
export function SessionMergeIndicator(props: { server: ServerConnection.Key; sessionID: string | undefined }) {
  const global = useGlobal()
  const language = useLanguage()
  const ctx = () => global.serverCtx(props.server)

  const query = useQuery(() => ({
    queryKey: [
      "session-merge",
      props.server,
      props.sessionID,
      props.sessionID ? ctx()?.data.session.get(props.sessionID)?.branch?.commit : undefined,
    ],
    queryFn: () => {
      const client = ctx()
      const sessionID = props.sessionID

      if (!client || !sessionID) throw new Error("Session unavailable")

      return client.sdk.api.session.merge({ sessionID })
    },
    enabled: !!props.sessionID && ctx()?.sdk.connection.status() === "connected",
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    throwOnError: false,
  }))

  const label = () => language.t("session.branch.merged", { branch: query.data?.target ?? "" })

  return (
    <Show when={!query.isError && query.data?.state === "merged"}>
      <span class="session-merge-indicator" role="img" aria-label={label()} title={label()}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <circle cx="4" cy="3" r="1.75" />
          <circle cx="4" cy="13" r="1.75" />
          <circle cx="12" cy="3" r="1.75" />
          <path d="M4 4.75v6.5M12 4.75v1A4.25 4.25 0 0 1 7.75 10H4" />
        </svg>
      </span>
    </Show>
  )
}
