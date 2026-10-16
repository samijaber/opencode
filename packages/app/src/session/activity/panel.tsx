import { createEffect, createMemo, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { MobilePanelDrawer } from "@/shell/mobile-panel-drawer"
import { useOpenSessionRoute } from "../session-identity-header"
import { sessionTreeIDs } from "../requests/session-request-tree"
import { sessionActivity, type ActivityItem } from "./model"
import { createActivityShellHistory } from "./shell-history"
import "./panel.css"

export function SessionActivityPanel(props: { sessionID: string }) {
  const data = useData()
  const sdk = useServerSDK()
  const language = useLanguage()
  const openRoute = useOpenSessionRoute()
  const [state, setState] = createStore<{
    open: boolean
    ready: boolean
    failed: boolean
    now: number
    trigger?: HTMLButtonElement
    output?: ActivityItem
    text: string
    loading: boolean
    outputFailed: boolean
    truncated: boolean
    cursor: number
  }>({
    open: false,
    ready: false,
    failed: false,
    now: Date.now(),
    text: "",
    loading: false,
    outputFailed: false,
    truncated: false,
    cursor: 0,
  })
  const ids = createMemo(() => sessionTreeIDs(data.session.list(), props.sessionID))
  const history = createActivityShellHistory(props.sessionID, ids)
  const activity = createMemo(() =>
    sessionActivity({
      sessionID: props.sessionID,
      sessions: data.session.list(),
      status: data.session.status,
      shells: data.shell.listBySession,
      history: history.items(),
      permissions: data.session.permission.list,
      forms: data.session.form.list,
    }),
  )
  const connected = () => sdk.connection.status() === "connected"
  const fresh = () => connected() && state.ready && !state.failed
  const generation = { value: 0 }

  const sync = () => {
    const version = ++generation.value
    setState({ ready: false, failed: false })
    if (!connected() || !history.ready()) return
    // Family reads are cached and paginated by the shared data layer. Newly found children extend this effect
    // until the whole tree is loaded; no transcript pages or command output are needed to show the count.
    const current = ids()
    const directories = [
      ...new Set(
        current.flatMap((id) => {
          const session = data.session.get(id)
          return session ? [session.location.directory] : []
        }),
      ),
    ]
    void Promise.all([
      ...current.map((id) => data.session.sync(id, { children: true })),
      ...current.map(data.session.permission.sync),
      ...current.map((id) => data.session.form.sync(id)),
      ...directories.map((directory) => data.shell.sync({ directory })),
    ])
      .then(() => history.sync())
      .then(() => {
        if (version === generation.value) setState("ready", true)
      })
      .catch(() => {
        if (version === generation.value) setState("failed", true)
      })
  }
  createEffect(on([() => props.sessionID, sdk.connection.status, history.ready, () => ids().join("\0")], sync))
  onCleanup(() => generation.value++)
  createEffect(
    on(
      () => props.sessionID,
      () => setState({ open: false, output: undefined }),
    ),
  )
  createEffect(() => {
    if (!state.open) return
    setState("now", Date.now())
    const timer = setInterval(() => setState("now", Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const summary = () => {
    if (!connected()) return language.t("session.activity.reconnecting")
    if (state.failed) return language.t("session.activity.loadFailed")
    if (!state.ready) return language.t("session.activity.loading")
    return language.activitySummary(activity().running.length, activity().attention.length, activity().unknown.length)
  }
  const output = (append = false) => {
    const item = state.output
    if (!item) return
    setState({ loading: true, outputFailed: false })
    void sdk.api.shell
      .output({
        id: item.id,
        location: data.session.get(item.sessionID)?.location,
        limit: 65536,
        cursor: append ? state.cursor : 0,
      })
      .then((result) => {
        if (state.output?.id === item.id)
          setState({
            text: append ? state.text + result.data.output : result.data.output,
            truncated: result.data.cursor < result.data.size,
            cursor: result.data.cursor,
          })
      })
      .catch(() => {
        if (state.output?.id === item.id) setState("outputFailed", true)
      })
      .finally(() => {
        if (state.output?.id === item.id) setState("loading", false)
      })
  }
  const open = (item: ActivityItem) => {
    if (item.type === "shell") {
      setState({ output: item, text: "", truncated: false })
      output()
      return
    }
    setState("open", false)
    openRoute(props.sessionID, item.sessionID)
  }
  const elapsed = (item: ActivityItem) => {
    const seconds = Math.max(0, Math.floor(((item.completed ?? state.now) - item.started) / 1000))
    return seconds >= 3600
      ? language.t("session.activity.hours", {
          hours: Math.floor(seconds / 3600),
          minutes: Math.floor((seconds % 3600) / 60),
        })
      : seconds >= 60
        ? language.t("session.activity.minutes", { count: Math.floor(seconds / 60) })
        : language.t("session.activity.seconds", { count: seconds })
  }
  const status = (item: ActivityItem) =>
    !fresh() && ["running", "permission", "question", "unknown"].includes(item.status)
      ? language.t("session.activity.stale")
      : language.t(`session.activity.status.${item.status}`)

  return (
    <div class="session-activity">
      <button
        ref={(element) => setState("trigger", element)}
        type="button"
        class="session-activity-trigger"
        aria-label={language.t("session.activity.title")}
        aria-haspopup="dialog"
        aria-expanded={state.open}
        onClick={() => {
          setState({ open: true, output: undefined })
          state.trigger?.blur()
        }}
      >
        <Icon name="status-active" />
        <span role="status">{summary()}</span>
        <Icon name="chevron-down" class="rotate-180" />
      </button>
      <MobilePanelDrawer
        title={language.t("session.activity.title")}
        open={state.open}
        onOpenChange={(open) => setState("open", open)}
        returnFocus={() => state.trigger}
      >
        <Show when={state.open}>
          <div class="session-activity-body">
            <Show when={!fresh()}>
              <p role="status">{summary()}</p>
            </Show>
            <Show when={state.failed}>
              <button class="session-activity-action" onClick={sync}>
                {language.t("session.activity.retry")}
              </button>
            </Show>
            <Show
              when={state.output}
              fallback={
                <>
                  <For each={["attention", "running", "unknown", "recent"] as const}>
                    {(group) => (
                      <Show when={activity()[group].length}>
                        <section aria-label={language.t(`session.activity.group.${group}`)}>
                          <h3>{language.t(`session.activity.group.${group}`)}</h3>
                          <ul>
                            <For each={activity()[group]}>
                              {(item) => (
                                <li>
                                  <button type="button" class="session-activity-row" onClick={() => open(item)}>
                                    <Icon name={item.type === "shell" ? "console" : "branch"} />
                                    <span class="session-activity-details">
                                      <bdi dir={item.type === "shell" ? "ltr" : "auto"}>{item.label}</bdi>
                                      <Show when={item.parentID && item.parentID !== props.sessionID}>
                                        <span class="session-activity-parent">
                                          <bdi>{data.session.get(item.parentID!)?.title ?? item.parentID}</bdi>
                                        </span>
                                      </Show>
                                      <span class="session-activity-meta">
                                        <span>{status(item)}</span>
                                        <time>{elapsed(item)}</time>
                                      </span>
                                    </span>
                                    <span class="session-activity-link">
                                      {language.t(
                                        item.type === "shell" ? "session.activity.output" : "session.activity.open",
                                      )}
                                    </span>
                                  </button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </section>
                      </Show>
                    )}
                  </For>
                  <Show when={fresh() && !Object.values(activity()).some((items) => items.length)}>
                    <p>{language.t("session.activity.empty")}</p>
                  </Show>
                </>
              }
            >
              {(item) => (
                <div>
                  <button type="button" class="session-activity-action" onClick={() => setState("output", undefined)}>
                    {language.t("common.goBack")}
                  </button>
                  <h3>
                    <bdi dir="ltr">{item().label}</bdi>
                  </h3>
                  <button
                    type="button"
                    class="session-activity-action"
                    disabled={state.loading || !connected()}
                    onClick={() => output()}
                  >
                    {language.t("session.activity.refreshOutput")}
                  </button>
                  <Show when={state.loading}>
                    <p role="status">{language.t("session.activity.loading")}</p>
                  </Show>
                  <Show when={state.outputFailed}>
                    <p role="alert">{language.t("session.activity.outputFailed")}</p>
                  </Show>
                  <Show when={!state.loading && !state.outputFailed && !state.text}>
                    <p>{language.t("session.activity.noOutput")}</p>
                  </Show>
                  <pre dir="ltr" class="session-activity-output">
                    {state.text}
                  </pre>
                  <Show when={state.truncated}>
                    <button
                      type="button"
                      class="session-activity-action"
                      disabled={state.loading || !connected()}
                      onClick={() => output(true)}
                    >
                      {language.t("session.activity.moreOutput")}
                    </button>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </MobilePanelDrawer>
    </div>
  )
}
