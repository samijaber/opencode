import type { Page } from "@playwright/test"
import type { SessionMessageInfo, SessionStatus, ShellInfo } from "@opencode/client/promise"
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
    sessionMerge: (id) => ({ state: id === nested.id ? "merged" : "unknown", target: "main" }),
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

export async function setupRecordedActivity(page: Page) {
  const messages: SessionMessageInfo[] = [
    { id: "msg_recorded_user", type: "user", text: "Start background checks", time: { created: 1 } },
    {
      id: "msg_recorded_tools",
      type: "assistant",
      agent: "build",
      model: { id: "model", providerID: "provider" },
      time: { created: 2, completed: 3 },
      content: ["missing", "finished", "live"].map((name) => ({
        type: "tool",
        id: `call_recorded_${name}`,
        name: "shell",
        time: { created: 2, ran: 2, completed: 3 },
        state: {
          status: "completed",
          input: { command: `pnpm check:${name}`, background: true },
          metadata: { shellID: `sh_recorded_${name}`, status: "running" },
          content: [{ type: "text", text: `Started ${name} background check` }],
        },
      })),
    },
    ...Array.from(
      { length: 110 },
      (_, index): SessionMessageInfo => ({
        id: `msg_recorded_filler_${index}`,
        type: "user",
        text: `Follow-up ${index}`,
        time: { created: index + 4 },
      }),
    ),
    {
      id: "msg_recorded_finished",
      type: "synthetic",
      text: "Finished background check",
      metadata: { source: "shell", jobID: "call_recorded_finished", state: "completed", exit: 0 },
      time: { created: 200 },
    },
  ]
  const fixture = await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    sessionMessages: messages,
    sessionStatus: { [sessionID]: { type: "idle" } },
    pageMessages: (_id, limit, before) => {
      const end = before ? messages.findIndex((message) => message.id === before) : messages.length
      const start = Math.max(0, end - limit)
      return { items: messages.slice(start, end), cursor: start > 0 ? messages[start].id : undefined }
    },
    shellCommands: [
      {
        id: "sh_recorded_live",
        command: "pnpm check:live",
        cwd: directory,
        shell: "zsh",
        file: "/fixture/output",
        status: "running",
        metadata: { sessionID },
        time: { started: 2 },
      },
    ],
  })
  return {
    ...fixture,
    finish() {
      messages.push({
        id: "msg_recorded_missing_finished",
        type: "synthetic",
        text: "Delayed completion arrived",
        metadata: { source: "shell", shellID: "sh_recorded_missing", state: "completed", exit: 1 },
        time: { created: 300 },
      })
    },
  }
}
