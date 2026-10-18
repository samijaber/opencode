import { expect, test } from "bun:test"
import type { SessionInfo, ShellInfo } from "@opencode/client/promise"
import { sessionActivity } from "./model"

const session = (id: string, parentID?: string): SessionInfo => ({
  id,
  parentID,
  title: id,
  projectID: "project",
  location: { directory: "/fixture" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
})
const shell = (id: string, sessionID: string, extra: Partial<ShellInfo> = {}): ShellInfo => ({
  id,
  metadata: { sessionID },
  command: "fixture command",
  cwd: "/fixture",
  shell: "zsh",
  file: "/fixture/output",
  status: "running",
  time: { started: 1 },
  ...extra,
})

// These classification rules are not covered by the navigation keeper: missing outcomes, terminal exit states,
// and the retention bound must not quietly turn unknown work into success or hide still-running work.
test("retains all live descendants but only the eight newest terminal results", () => {
  const sessions = [session("root"), session("child", "root"), session("nested", "child"), session("unrelated")]
  const commands = [
    shell("live", "nested"),
    ...Array.from({ length: 12 }, (_, i) =>
      shell(`done-${i}`, "child", { status: "exited", exit: 0, time: { started: 1, completed: i + 2 } }),
    ),
  ]
  const result = sessionActivity({
    sessionID: "root",
    sessions,
    status: () => "running",
    shells: (id) => commands.filter((item) => item.metadata.sessionID === id),
    permissions: () => [],
    forms: () => [],
  })
  expect(result.running.map((item) => item.id)).toEqual(["child", "nested", "live"])
  expect(result.recent.map((item) => item.id)).toEqual([
    "done-11",
    "done-10",
    "done-9",
    "done-8",
    "done-7",
    "done-6",
    "done-5",
    "done-4",
  ])
})

test("does not infer success from idle sessions or absent shell exit codes", () => {
  const commands = [
    shell("unknown", "root", { status: "exited" }),
    shell("failed", "root", { status: "exited", exit: 1 }),
    shell("timeout", "root", { status: "timeout" }),
    shell("stopped", "root", { status: "killed" }),
  ]
  const result = sessionActivity({
    sessionID: "root",
    sessions: [session("root"), session("child", "root")],
    status: () => "idle",
    shells: (id) => (id === "root" ? commands : []),
    permissions: () => [],
    forms: () => [],
  })
  expect(result.unknown.map((item) => item.id)).toEqual(["child", "unknown"])
  expect(result.attention.map((item) => [item.id, item.status])).toEqual([
    ["failed", "failed"],
    ["timeout", "failed"],
  ])
  expect(result.recent.map((item) => [item.id, item.status])).toEqual([["stopped", "interrupted"]])
  expect(result.running).toEqual([])
})
