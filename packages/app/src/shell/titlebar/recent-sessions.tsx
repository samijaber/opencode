import { createMemo, Index, Show, startTransition } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useLayout } from "@/shell/state/layout"
import { useTabs, type Tab } from "@/shell/tabs/tabs"
import { useLanguage } from "@/runtime/i18n/language"
import { createRecentSessionIndex } from "@/home/sessions/query"
import { buildHomeSessionRecords } from "@/home/sessions/records"
import { groupSessions } from "@/home/sessions/groups"
import { HOME_SESSION_LIMIT } from "@/home/sessions/index"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { sessionHref } from "@/shell/routes/session"
import { sessionTitle } from "@/session/title"

export function RecentSessions(props: { currentTab?: Tab; onNavigate?: () => void }) {
  const global = useGlobal()
  const servers = useServers()
  const layout = useLayout()
  const tabs = useTabs()
  const language = useLanguage()
  const connection = createMemo(() => {
    const key = props.currentTab?.server ?? layout.home.selection().server
    return servers.visible.find((item) => ServerConnection.key(item) === key) ?? servers.visible[0]
  })
  const context = useServerCtx(connection)
  const index = createRecentSessionIndex(context, connection)
  const groups = createMemo(() =>
    groupSessions(
      buildHomeSessionRecords({
        sessions: index.sessions,
        projectDirectories: () => undefined,
        projects: () => context()?.projects.available() ?? [],
        resolveProject: (session) => context()?.projects.forSession(session),
      }).slice(0, HOME_SESSION_LIMIT),
      language,
    ),
  )

  return (
    <nav
      aria-label={language.t("sidebar.project.recentSessions")}
      class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [app-region:no-drag]"
    >
      <Show
        when={!index.load.isPending}
        fallback={<p class="px-2 py-2 text-13-regular text-v2-text-text-muted">{language.t("common.loading")}</p>}
      >
        <Show when={index.load.isError}>
          <button
            type="button"
            class="px-2 py-2 text-13-regular text-v2-text-text-base"
            onClick={() => void index.load.refetch()}
          >
            {language.t("common.retry")}
          </button>
        </Show>
        <Show when={!index.load.isError && groups().length === 0}>
          <p class="px-2 py-2 text-13-regular text-v2-text-text-muted">{language.t("home.sessions.empty")}</p>
        </Show>
        <Index each={groups()}>
          {(group) => (
            <section aria-label={group().title} class="mb-3">
              <h2 class="sticky top-0 z-10 bg-v2-background-bg-deep px-2 py-2 text-11-medium text-v2-text-text-muted">
                {group().title}
              </h2>
              <Key each={group().sessions} by={(record) => record.session.id}>
                {(record) => (
                  <a
                    href={sessionHref(ServerConnection.key(connection()!), record().session.id)}
                    aria-label={sessionTitle(record().session.title)}
                    aria-current={
                      props.currentTab?.type === "session" &&
                      props.currentTab.sessionId === record().session.id &&
                      props.currentTab.server === ServerConnection.key(connection()!)
                        ? "page"
                        : undefined
                    }
                    class="flex h-9 min-w-0 items-center gap-2 rounded-[6px] px-2 text-13-regular text-v2-text-text-base hover:bg-v2-background-bg-layer-02 focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02 aria-[current=page]:bg-v2-background-bg-layer-02"
                    title={`${sessionTitle(record().session.title)} · ${record().projectName}`}
                    onClick={(event) => {
                      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                      event.preventDefault()
                      const conn = connection()
                      if (!conn) return
                      const ctx = global.ensureServerCtx(conn)
                      ctx.data.session.remember(record().session)
                      ctx.projects.open(record().project.worktree)
                      ctx.projects.touch(record().project.worktree)
                      void startTransition(() => {
                        tabs.select(
                          tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: record().session.id }),
                        )
                        props.onNavigate?.()
                      })
                    }}
                  >
                    <SessionTabAvatar
                      project={record().project}
                      directory={record().session.location.directory}
                      sessionId={record().session.id}
                      server={ServerConnection.key(connection()!)}
                    />
                    <span dir="auto" class="min-w-0 flex-1 truncate text-start">
                      {sessionTitle(record().session.title)}
                    </span>
                  </a>
                )}
              </Key>
            </section>
          )}
        </Index>
      </Show>
    </nav>
  )
}
