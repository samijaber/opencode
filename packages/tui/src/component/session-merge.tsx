import { createEffect, onCleanup, Show } from "solid-js"
import { useData } from "../context/data"
import { useTheme } from "../context/theme"

export function createSessionMerged(sessionID: () => string, data: ReturnType<typeof useData> | undefined) {
  createEffect(() => {
    const id = sessionID()
    if (!data || id === "new" || id === "dummy") return
    onCleanup(data.session.merge.watch(id))
  })
  createEffect(() => {
    const id = sessionID()
    if (!data || id === "new" || id === "dummy") return
    data.session.get(id)?.branch?.commit
    data.session.merge.sync(id)
  })
  return () => data?.session.merge.get(sessionID())?.state === "merged"
}

export function SessionMergeIndicator(props: { sessionID: string }) {
  const data = useData()
  const theme = useTheme()
  const merged = createSessionMerged(() => props.sessionID, data)
  return (
    <Show when={merged()}>
      <span style={{ fg: theme.text.feedback.success.base }}>✓ </span>
    </Show>
  )
}
