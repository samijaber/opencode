export * as SessionMerge from "./merge.js"

import { Cache, Context, Effect, Layer, Schema, Semaphore, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { SessionBranch } from "@opencode/schema/session-branch"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/schema/schema"
import { AppProcess } from "@opencode/util/process"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Repository } from "../repository.js"
import { gitExecutable } from "../util/git-executable.js"
import { SessionEvent } from "./event.js"
import { SessionStore } from "./store.js"

const PullRequests = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      baseRefName: Schema.String,
      headRefOid: Schema.String,
      mergedAt: Schema.NullOr(Schema.String),
      url: Schema.String,
    }),
  ),
)

export interface Interface {
  readonly observe: (session: Session.Info) => Effect.Effect<void>
  readonly get: (session: Session.Info) => Effect.Effect<SessionBranch.Merge>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMerge") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const proc = yield* AppProcess.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const commands = Semaphore.makeUnsafe(4)
    const observations = Semaphore.makeUnsafe(1)
    const run = Effect.fnUntraced(function* (command: string, args: string[], cwd?: string) {
      return yield* proc
        .run(
          ChildProcess.make(command, args, {
            cwd,
            stdin: "ignore",
            env: { GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
            extendEnv: true,
          }),
          { timeout: "8 seconds", maxOutputBytes: 64 * 1024 },
        )
        .pipe(
          Semaphore.withPermit(commands),
          Effect.map((result) =>
            result.exitCode === 0 && !result.stdoutTruncated ? result.stdout.toString("utf8").trim() : undefined,
          ),
          Effect.orElseSucceed(() => undefined),
        )
    })
    const git = (directory: string, args: string[]) => run(gitExecutable, ["--no-optional-locks", ...args], directory)
    const inspect = Effect.fnUntraced(function* (directory: string): Effect.fn.Return<SessionBranch.Info | undefined> {
      const name = yield* git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      if (!name) return
      const remoteHead = yield* git(directory, ["symbolic-ref", "refs/remotes/origin/HEAD"])
      const local = remoteHead
        ? undefined
        : yield* git(directory, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
      const target =
        remoteHead?.replace(/^refs\/remotes\/origin\//, "") ??
        ["main", "master", "dev"].find((branch) => local?.split("\n").includes(branch))
      if (!target || name === target) return
      const commit = yield* git(directory, ["rev-parse", "--verify", "HEAD"])
      const repository = yield* git(directory, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
      if (!commit || !repository) return
      const history = yield* git(directory, [
        "reflog",
        "show",
        "--max-count=256",
        "--format=%H%x00%gs",
        `refs/heads/${name}`,
      ])
      const start = history
        ?.split("\n")
        .find((line) => line.includes("\0branch: Created from "))
        ?.split("\0")[0]
      return {
        directory: AbsolutePath.make(directory),
        repository: AbsolutePath.make(repository),
        name,
        target,
        commit,
        start,
      }
    })
    const directories = yield* Cache.make({ capacity: 256, timeToLive: "30 seconds", lookup: inspect })
    const observe = Effect.fn("SessionMerge.observe")(function* (session: Session.Info) {
      // Re-read after taking the lock: simultaneous title consumers must not record duplicate facts.
      yield* Effect.gen(function* () {
        const current = yield* store.get(session.id)
        if (!current) return
        const next = yield* inspect(current.location.directory)
        if (!next || JSON.stringify(next) === JSON.stringify(current.branch)) return
        yield* bus.publish(SessionEvent.BranchUpdated, { sessionID: current.id, branch: next })
        yield* Cache.invalidate(directories, current.location.directory)
      }).pipe(Semaphore.withPermit(observations))
    })
    const check = Effect.fn("SessionMerge.check")(function* (encoded: string): Effect.fn.Return<SessionBranch.Merge> {
      const branch = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionBranch.Info))(encoded).pipe(
        Effect.orDie,
      )
      const args = [`--git-dir=${branch.repository}`]
      const tip = yield* run(gitExecutable, [...args, "rev-parse", "--verify", `refs/heads/${branch.name}^{commit}`])
      const commit = tip ?? branch.commit
      const details = { branch: branch.name, target: branch.target }
      if (branch.start === commit) return { state: "unmerged", ...details }
      const remote = yield* run(gitExecutable, [...args, "config", "--get", "remote.origin.url"])
      const ref = remote ? `refs/remotes/origin/${branch.target}` : `refs/heads/${branch.target}`
      const target = yield* run(gitExecutable, [...args, "rev-parse", "--verify", `${ref}^{commit}`])
      // A freshly-created branch points at main too; that is not evidence of a merge.
      if (target && branch.start && branch.start !== commit) {
        const ancestor = yield* run(gitExecutable, [...args, "merge-base", "--is-ancestor", commit, target])
        if (ancestor !== undefined) return { state: "merged", ...details }
      }
      if (!remote) return { state: target ? "unmerged" : "unknown", ...details }
      const repository = Repository.parse(remote)
      if (!repository || Repository.isFile(repository)) return { state: "unknown", ...details }
      const response = yield* run("gh", [
        "pr",
        "list",
        "--repo",
        `${repository.host}/${repository.path}`,
        "--head",
        branch.name,
        "--base",
        branch.target,
        "--state",
        "merged",
        "--limit",
        "20",
        "--json",
        "baseRefName,headRefOid,mergedAt,url",
      ])
      if (response === undefined) return { state: "unknown", ...details }
      const prs = yield* Schema.decodeUnknownEffect(PullRequests)(response).pipe(Effect.orElseSucceed(() => undefined))
      if (!prs) return { state: "unknown", ...details }
      // Exact tip matching handles squash/rebase merges without marking new, unmerged work on a reused branch.
      const merged = prs.find((pr) => pr.mergedAt && pr.baseRefName === branch.target && pr.headRefOid === commit)
      return merged ? { state: "merged", ...details, url: merged.url } : { state: "unmerged", ...details }
    })
    const statuses = yield* Cache.make({ capacity: 512, timeToLive: "30 seconds", lookup: check })
    yield* bus
      .subscribe([
        SessionEvent.Moved,
        SessionEvent.Execution.Started,
        SessionEvent.Execution.Succeeded,
        SessionEvent.Execution.Failed,
        SessionEvent.Execution.Interrupted,
      ])
      .pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const session = yield* store.get(event.data.sessionID)
            if (session && !session.location.workspaceID) yield* observe(session)
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
    return Service.of({
      observe,
      get: Effect.fn("SessionMerge.get")(function* (session) {
        if (session.location.workspaceID) return { state: "unknown" }
        // Old sessions have no recorded branch. Only backfill an isolated worktree, never a shared checkout.
        const recorded = session.branch
        const current = yield* Cache.get(directories, session.location.directory)
        if (!recorded) {
          const gitDir = current
            ? yield* git(session.location.directory, ["rev-parse", "--path-format=absolute", "--git-dir"])
            : undefined
          if (!current || gitDir === current.repository || !gitDir) return { state: "unknown" }
          yield* observe(session)
        }
        const branch = recorded ?? (yield* store.get(session.id))?.branch
        if (!branch) return { state: "unknown" }
        // For the same recorded branch, check today's tip as well: new commits must clear a previous badge.
        const latest = current?.name === branch.name && current.repository === branch.repository ? current : branch
        return yield* Cache.get(statuses, JSON.stringify(latest))
      }),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [AppProcess.node, Bus.node, SessionStore.node] })
