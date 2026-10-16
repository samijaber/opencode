import type { Page } from "@playwright/test"
import type { SessionStatus, ShellInfo } from "@opencode/client/promise"
import { directory, session, sessionID, setupTimeline } from "./timeline"

export async function setupActivity(page: Page, attention = false) {
  const child = session({ id: "ses_activity_child", parentID: sessionID, title: "Review changes" })
  const nested = session({ id: "ses_activity_nested", parentID: child.id, title: "Check migrations" })
  const sessions = [session(), child, nested]
  const status: Record<string, SessionStatus> = {
    [sessionID]: { type: "idle" },
    [child.id]: { type: "busy" },
    [nested.id]: { type: "busy" },
  }
  const commands: ShellInfo[] = [
    {
      id: "sh_activity_tests",
      command: [
        "pnpm test:integration \\",
        ...Array.from(
          { length: 8 },
          (_, index) => `  --fixture-${index}=a-long-synthetic-configuration-value-for-mobile-layout \\`,
        ),
        "  --reporter=verbose",
      ].join("\n"),
      cwd: directory,
      shell: "zsh",
      file: "/fixture/output",
      status: "running",
      metadata: { sessionID },
      time: { started: Date.now() - 60000 },
    },
  ]
  const permissions = attention
    ? [
        {
          id: "permission-activity",
          sessionID: nested.id,
          permission: "shell",
          patterns: ["git diff"],
          metadata: {},
          always: [],
        },
      ]
    : []
  const fixture = await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    sessions,
    sessionStatus: status,
    sessionMessages: [
      { id: "msg_activity_root", type: "user", text: "Review the synthetic fixture", time: { created: 1 } },
    ],
    sessionPermissions: { [nested.id]: permissions },
    shellCommands: () => commands,
    shellOutput: () => "Synthetic integration tests: 12 passed\n",
  })
  return {
    ...fixture,
    child,
    nested,
    async finishShell() {
      commands[0].status = "exited"
      commands[0].exit = 0
      commands[0].time.completed = Date.now()
      await fixture.transport.send({
        id: "event_activity_shell_exit",
        type: "shell.exited",
        created: commands[0].time.completed,
        location: { directory },
        data: { id: commands[0].id, status: "exited", exit: 0 },
      })
    },
    finish() {
      status[child.id] = { type: "idle" }
      status[nested.id] = { type: "idle" }
      child.outcome = "succeeded"
      nested.outcome = "failed"
      child.time.idle = Date.now()
      nested.time.idle = Date.now()
      permissions.splice(0)
      commands[0].status = "exited"
      commands[0].exit = 0
      commands[0].time.completed = Date.now()
    },
  }
}
