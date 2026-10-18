import { expect } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppProcess } from "@opencode/util/process"
import { Bus } from "@opencode/core/bus"
import { Project } from "@opencode/core/project"
import { Session } from "@opencode/core/session"
import { SessionMerge } from "@opencode/core/session/merge"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/schema/schema"
import { SessionBranch } from "@opencode/schema/session-branch"
import { Schema } from "effect"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"
import { promptLocationNode } from "./fixture/prompt-location"
import { tmpdirScoped } from "./fixture/tmpdir"
import { initGit } from "./fixture/git"

const nodes = LayerNode.group([Session.node, SessionMerge.node, SessionProjector.node, AppProcess.node])
const replacements = [
  Bus.node.replace(Bus.configured({ persist: true })),
  Project.node.replace(globalProjectNode),
  LocationServiceMap.node.replace(promptLocationNode),
  SessionExecution.node.replace(SessionExecution.noopLayer),
]
const it = testEffect(AppNodeBuilder.build(nodes, replacements))

it.live(
  "records feature branch identity, excludes fresh/main branches, survives removed worktrees and clears for new commits",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const directory = AbsolutePath.make(path.join(tmp.path, "repo"))
      const worktree = AbsolutePath.make(path.join(tmp.path, "feature"))
      yield* Effect.promise(async () => {
        await initGit(directory, "-b", "main")
        await $`git commit --allow-empty -m root`.cwd(directory).quiet()
        await $`git worktree add -b feature ${worktree}`.cwd(directory).quiet()
      })
      const sessions = yield* Session.Service
      const merge = yield* SessionMerge.Service
      const main = yield* sessions.create({ location: { directory } })
      expect(main.branch).toBeUndefined()
      expect((yield* merge.get(main)).state).toBe("unknown")
      const feature = yield* sessions.create({ location: { directory: worktree } })
      expect(feature.branch?.name).toBe("feature")
      expect((yield* merge.get(feature)).state).toBe("unmerged")
      yield* Effect.promise(async () => {
        await $`git commit --allow-empty -m feature`.cwd(worktree).quiet()
      })
      yield* merge.observe(feature)
      const recorded = yield* sessions.get(feature.id)
      expect(recorded.time.updated).toEqual(feature.time.updated)
      expect(recorded.branch?.commit).not.toBe(feature.branch?.commit)
      yield* Effect.promise(async () => {
        await $`git merge --ff-only feature`.cwd(directory).quiet()
        await $`git worktree remove ${worktree}`.cwd(directory).quiet()
      })
      expect(yield* merge.get(recorded)).toMatchObject({ state: "merged", branch: "feature", target: "main" })
      yield* Effect.promise(async () => {
        await $`git worktree add ${worktree} feature`.cwd(directory).quiet()
        await $`git commit --allow-empty -m more`.cwd(worktree).quiet()
      })
      yield* merge.observe(recorded)
      expect((yield* merge.get(yield* sessions.get(feature.id))).state).toBe("unmerged")
    }),
)

it.live("matches squash/rebase PR evidence by exact head and target, and treats unavailable GitHub as unknown", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const directory = AbsolutePath.make(tmp.path)
    yield* Effect.promise(async () => {
      await initGit(directory, "-b", "main")
      await $`git commit --allow-empty -m root`.cwd(directory).quiet()
      await $`git checkout -b feature`.cwd(directory).quiet()
      await $`git commit --allow-empty -m feature`.cwd(directory).quiet()
      await $`git remote add origin https://github.com/example/project.git`.cwd(directory).quiet()
    })
    const sessions = yield* Session.Service
    const feature = yield* sessions.create({ location: { directory } })
    const branch = feature.branch
    expect(branch).toBeDefined()
    if (!branch) return
    const proc = yield* AppProcess.Service
    const result = (stdout: string, exitCode = 0): AppProcess.RunResult => ({
      command: "gh",
      exitCode,
      stdout: Buffer.from(stdout),
      stderr: Buffer.alloc(0),
      stdoutTruncated: false,
      stderrTruncated: false,
    })
    const cases: { response: AppProcess.RunResult; expected: SessionBranch.Merge["state"] }[] = [
      {
        response: result(
          JSON.stringify([
            {
              baseRefName: "main",
              headRefOid: branch.commit,
              mergedAt: "2026-10-17T00:00:00Z",
              url: "https://github.com/example/project/pull/1",
            },
          ]),
        ),
        expected: "merged",
      },
      {
        response: result(
          JSON.stringify([
            {
              baseRefName: "main",
              headRefOid: "0".repeat(40),
              mergedAt: "2026-10-17T00:00:00Z",
              url: "https://github.com/example/project/pull/1",
            },
          ]),
        ),
        expected: "unmerged",
      },
      {
        response: result(
          JSON.stringify([
            {
              baseRefName: "release",
              headRefOid: branch.commit,
              mergedAt: "2026-10-17T00:00:00Z",
              url: "https://github.com/example/project/pull/1",
            },
          ]),
        ),
        expected: "unmerged",
      },
      { response: result("not authenticated", 1), expected: "unknown" },
      { response: result("invalid JSON"), expected: "unknown" },
    ]
    for (const item of cases) {
      const value = yield* SessionMerge.Service.use((merge) => merge.get(feature)).pipe(
        Effect.provide(
          AppNodeBuilder.build(LayerNode.group([SessionMerge.node]), [
            ...replacements,
            AppProcess.node.replace(
              Layer.succeed(AppProcess.Service, {
                ...proc,
                run: (command, options) =>
                  command._tag === "StandardCommand" && command.command === "gh"
                    ? Effect.succeed(item.response)
                    : proc.run(command, options),
              }),
            ),
          ]).pipe(Layer.fresh),
        ),
      )
      expect(value.state).toBe(item.expected)
    }
    const encoded = Schema.encodeSync(SessionBranch.Merge)({ state: "unknown" })
    expect(encoded).toEqual({ state: "unknown" })
  }),
)
