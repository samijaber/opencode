import { createData } from "@opencode/client/solid"
import type { LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { createStore } from "solid-js/store"
import { onCleanup } from "solid-js"
import type { SessionBranch } from "@opencode/schema/session-branch"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"

export { locationKey } from "@opencode/client/solid"
export type { FormWithLocation } from "@opencode/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { directory: string }) => {
    const client = useClient()
    const data = createData({
      api: () => client.api,
      event: client.event,
      connection: client.connection,
      directory: props.directory,
    })
    data satisfies Plugin.Context["data"]
    const [generatingTitles, setGeneratingTitles] = createStore<Record<string, boolean | undefined>>({})
    const [merges, setMerges] = createStore<Record<string, SessionBranch.Merge | undefined>>({})
    const watched = new Map<string, number>()
    const checked = new Map<string, { time: number; commit?: string }>()
    const pending = new Set<string>()
    const syncMerge = (sessionID: string) => {
      const commit = data.session.get(sessionID)?.branch?.commit
      const previous = checked.get(sessionID)
      if (pending.has(sessionID) || (previous && previous.commit === commit && Date.now() - previous.time < 30_000))
        return
      pending.add(sessionID)
      if (previous?.commit !== commit) setMerges(sessionID, { state: "unknown" })
      checked.set(sessionID, { time: Date.now(), commit })
      void client.api.session
        .merge({ sessionID })
        .then(
          (value) => setMerges(sessionID, value),
          () => setMerges(sessionID, { state: "unknown" }),
        )
        .finally(() => {
          pending.delete(sessionID)
          if (watched.has(sessionID) && data.session.get(sessionID)?.branch?.commit !== commit) syncMerge(sessionID)
        })
    }
    const timer = setInterval(() => watched.forEach((_, id) => syncMerge(id)), 60_000)
    onCleanup(() => clearInterval(timer))
    return {
      ...data,
      location: {
        ...data.location,
        async sync(ref?: LocationRef) {
          await data.location.syncInfo(ref)
          await Promise.all([data.location.sync(ref), data.location.config.sync(ref)])
        },
      },
      session: {
        ...data.session,
        merge: {
          get: (sessionID: string) => merges[sessionID],
          sync: syncMerge,
          watch(sessionID: string) {
            watched.set(sessionID, (watched.get(sessionID) ?? 0) + 1)
            syncMerge(sessionID)
            return () => {
              const count = (watched.get(sessionID) ?? 1) - 1
              if (count > 0) watched.set(sessionID, count)
              else {
                watched.delete(sessionID)
                checked.delete(sessionID)
                setMerges(sessionID, undefined)
              }
            }
          },
        },
        title: {
          pending: (sessionID: string) => generatingTitles[sessionID] === true,
          async generate(sessionID: string) {
            if (generatingTitles[sessionID]) return
            setGeneratingTitles(sessionID, true)
            await client.api.session
              .update({ sessionID, title: "" })
              .then(() => {
                // The HTTP response can beat the renamed event. Keep pending until the new title is projected locally.
                data.session.invalidate(sessionID)
                return data.session.sync(sessionID)
              })
              .finally(() => setGeneratingTitles(sessionID, undefined))
          },
        },
      },
    }
  },
})
