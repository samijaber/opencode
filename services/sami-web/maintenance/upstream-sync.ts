import { mkdir, rmdir } from "node:fs/promises"
import path from "node:path"

type Gate = { name: string; cwd?: string; args: string[]; env?: Record<string, string> }
type Options = {
  repo: string
  state: string
  upstream: string
  fork: string
  branch: string
  gates: Gate[]
  check?: boolean
  retry?: boolean
  preview?: boolean
}
type Status = {
  base: string
  upstream: string
  count: number
  status: string
  reason?: string
  worktree?: string
  commit?: string
  checkedAt?: string
}

export async function reconcile(options: Options): Promise<Status> {
  if (!options.gates.length) throw new Error("At least one verification gate is required")
  await mkdir(options.state, { recursive: true })
  // A crash deliberately leaves the lock for inspection, rather than starting overlapping merges.
  await mkdir(path.join(options.state, "lock"))
  try {
    const git = (...args: string[]) => command(["git", ...args], options.repo)
    await git("fetch", "--no-tags", options.fork, `refs/heads/${options.branch}`)
    const base = await git("rev-parse", "FETCH_HEAD")
    await git("fetch", "--no-tags", options.upstream, "refs/heads/dev")
    const upstream = await git("rev-parse", "FETCH_HEAD")
    const count = Number(await git("rev-list", "--count", `${base}..${upstream}`))
    const snapshot = { base, upstream, count }
    if (!count || options.check) return { ...snapshot, status: count ? "available" : "current" }

    const previous = await (Bun.file(path.join(options.state, "status.json")).json() as Promise<Status>).catch(
      () => undefined,
    )
    if (!options.retry && previous?.base === base && previous?.upstream === upstream && previous?.status === "blocked")
      return previous

    const worktree = path.join(options.state, "worktrees", crypto.randomUUID())
    await git("worktree", "add", "--detach", worktree, base)
    const result = await mergeAndCheck(options, worktree, base, upstream).catch((error: Error) => ({
      status: "blocked",
      reason: error.message,
    }))
    const status = { ...snapshot, ...result, worktree, checkedAt: new Date().toISOString() }
    await Bun.write(path.join(options.state, "status.json"), JSON.stringify(status, null, 2) + "\n")
    // Failed/preview checkouts stay intact for reconciliation. Never clean or reset a user's worktree.
    if (status.status === "merged") await git("worktree", "remove", worktree)
    return status
  } finally {
    await rmdir(path.join(options.state, "lock"))
  }
}

async function mergeAndCheck(options: Options, worktree: string, base: string, upstream: string) {
  const git = (...args: string[]) => command(["git", ...args], worktree)
  await git("merge", "--no-ff", "--no-commit", upstream).catch(async () => {
    const conflicts = await git("diff", "--name-only", "--diff-filter=U")
    throw new Error(conflicts ? `Merge conflicts:\n${conflicts}` : "Git merge failed; inspect the retained checkout")
  })
  for (const gate of options.gates) {
    console.log(`Verification: ${gate.name}`)
    await command(gate.args, path.join(worktree, gate.cwd ?? ""), gate.env, true).catch(() => {
      throw new Error(`Verification failed: ${gate.name}. See the authenticated scheduler log.`)
    })
  }
  // Only the merge result is admitted: installs/builds must not silently add tracked changes.
  await git("diff", "--exit-code")
  await git("commit", "-m", `chore(sync): merge upstream dev (${upstream.slice(0, 10)})`)
  if (await git("status", "--porcelain")) throw new Error("Verification left uncommitted files")
  const commit = await git("rev-parse", "HEAD")
  if (options.preview) return { status: "verified", commit }
  const remote = await git("ls-remote", "--exit-code", options.fork, `refs/heads/${options.branch}`)
  if (remote.split(/\s/)[0] !== base)
    throw new Error("Custom branch changed during verification; retry against its new tip")
  // A normal push also rejects a concurrent branch update. No force, rebase, or live-service operation.
  await git("push", options.fork, `HEAD:refs/heads/${options.branch}`)
  return { status: "merged", commit }
}

async function command(args: string[], cwd: string, env?: Record<string, string>, stream = false) {
  console.log(`$ ${args.join(" ")}`)
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...env },
    stdin: "ignore",
    stdout: stream ? "inherit" : "pipe",
    stderr: "inherit",
  })
  const output = stream ? "" : await new Response(child.stdout).text()
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${args[0]} ${args[1]}`)
  return output.trim()
}

async function report(result: Awaited<ReturnType<typeof reconcile>>, repo: string) {
  const title = "OpenCode upstream sync needs attention"
  const issues = JSON.parse(
    await command(
      [
        "gh",
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "open",
        "--search",
        `in:title \"${title}\"`,
        "--json",
        "number,title",
      ],
      process.cwd(),
    ),
  ) as { number: number; title: string }[]
  const issue = issues.find((item) => item.title === title)
  if (result.status !== "blocked") {
    if (issue && (result.status === "merged" || result.status === "current"))
      await command(
        ["gh", "issue", "close", String(issue.number), "--repo", repo, "--comment", "Upstream sync is healthy again."],
        process.cwd(),
      )
    return
  }
  const body = [
    "The daily upstream merge was blocked. The custom branch and live server were not changed.",
    `Custom tip: \`${result.base}\``,
    `Upstream tip: \`${result.upstream}\` (${result.count} incoming commits)`,
    result.reason,
    "The isolated checkout is retained on the owner's Mac. Resolve the failure there or retry from a new snapshot; do not reset active development worktrees.",
    "Scheduler: https://hub.samijaber.com/verification/dags/opencode-upstream",
    "No credentials, local logs, or conversation data are published here.",
  ].join("\n\n")
  await command(
    issue
      ? ["gh", "issue", "edit", String(issue.number), "--repo", repo, "--body", body]
      : ["gh", "issue", "create", "--repo", repo, "--title", title, "--body", body],
    process.cwd(),
  )
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.length < 2 || args.slice(2).some((arg) => !["--check", "--retry", "--preview"].includes(arg)))
    throw new Error("Usage: bun upstream-sync.ts <repository> <state-directory> [--check] [--retry] [--preview]")
  const bun = ["mise", "exec", "bun@1.4.4", "--", "bun"]
  const result = await reconcile({
    repo: path.resolve(args[0]),
    state: path.resolve(args[1]),
    upstream: "https://github.com/anomalyco/opencode.git",
    fork: "https://github.com/samijaber/opencode.git",
    branch: "main",
    check: args.includes("--check"),
    retry: args.includes("--retry"),
    preview: args.includes("--preview"),
    gates: [
      { name: "Frozen dependency install", args: [...bun, "install", "--frozen-lockfile"] },
      { name: "Full lint and typecheck", args: [...bun, "run", "check"] },
      {
        name: "Custom worker, Hub, shared-preference and maintenance tests",
        cwd: "services/sami-web",
        args: [...bun, "run", "test"],
      },
      {
        name: "Production custom recents, badges and native touch scrolling",
        cwd: "packages/app",
        args: [
          ...bun,
          "run",
          "test:e2e:built",
          "e2e/regression/tabs.spec.ts",
          "--grep",
          "custom |mobile tab picker scrolls",
          "--workers=1",
          "--retries=0",
        ],
        env: { PLAYWRIGHT_PORT: "4473" },
      },
      { name: "Production custom frontend build", cwd: "services/sami-web", args: [...bun, "run", "build"] },
    ],
  })
  console.log(JSON.stringify(result, null, 2))
  if (!args.includes("--check") && !args.includes("--preview")) await report(result, "samijaber/opencode")
  if (result.status === "blocked") process.exitCode = 1
}
