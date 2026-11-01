import { expect, test } from "bun:test"
import { mkdir, rmdir, stat } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../../../packages/core/test/fixture/tmpdir"
import { gitRemote } from "../../../packages/core/test/fixture/git"
import { reconcile } from "../maintenance/upstream-sync"

// Real repositories protect the remote-write boundary; no network or live service is involved.
// Each case performs ~30 Git operations, so allow for Git-for-Windows process startup.
test.each(["merge", "conflict", "failed-check", "concurrent-push", "preview", "check", "current"])(
  "daily upstream sync: %s",
  async (mode) => {
    await using root = await tmpdir()
    const fixture = await gitRemote(root.path)
    const git = async (...args: string[]) => {
      const child = Bun.spawn(["git", ...args], { cwd: fixture.source, stdout: "pipe", stderr: "pipe" })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      expect(await child.exited, error).toBe(0)
      return output.trim()
    }
    await git("switch", "-c", "session-activity")
    await Bun.write(path.join(fixture.source, "custom.txt"), "keep custom features\n")
    await git("add", ".")
    await git("commit", "-m", "custom")
    await git("push", "origin", "session-activity")
    const base = await git("rev-parse", "HEAD")
    await git("switch", "-c", "dev", mode === "current" ? base : "main")
    await Bun.write(
      path.join(fixture.source, mode === "conflict" ? "custom.txt" : "upstream.txt"),
      "upstream changes\n",
    )
    await git("add", ".")
    await git("commit", "-m", "upstream")
    await git("push", "origin", "dev")
    if (mode === "current") await git("push", "origin", "dev:session-activity")
    const upstream = await git("rev-parse", "HEAD")
    await Bun.write(path.join(fixture.source, "uncommitted.txt"), "user work must survive\n")
    const state = path.join(root.path, "state")
    const gate = path.join(root.path, "gate.ts")
    const concurrent =
      mode === "concurrent-push"
        ? await git("commit-tree", `${base}^{tree}`, "-p", base, "-m", "concurrent work")
        : base
    await Bun.write(
      gate,
      mode === "concurrent-push"
        ? `const p = Bun.spawn(["git", "push", "origin", "${concurrent}:session-activity"], {cwd: ${JSON.stringify(fixture.source)}}); process.exit(await p.exited)`
        : `await Bun.write(${JSON.stringify(path.join(root.path, "gate-ran"))}, "yes"); process.exit(${mode === "failed-check" ? 1 : 0})`,
    )
    const options = {
      repo: fixture.source,
      state,
      upstream: fixture.remote,
      fork: fixture.remote,
      branch: "session-activity",
      gates: [{ name: "fixture verification", args: [process.execPath, gate] }],
      preview: mode === "preview",
      check: mode === "check",
    }
    const result = await reconcile(options)
    const remote = (await git("ls-remote", "origin", "refs/heads/session-activity")).split(/\s/)[0]
    expect(await Bun.file(path.join(fixture.source, "uncommitted.txt")).text()).toBe("user work must survive\n")
    expect(await git("rev-parse", "HEAD")).toBe(upstream)
    await expect(stat(path.join(state, "lock"))).rejects.toThrow("ENOENT")
    if (mode === "merge") {
      expect(result.status).toBe("merged")
      expect(remote).toBe(result.commit!)
      expect(await git("show", `${remote}:custom.txt`)).toBe("keep custom features")
      expect(await git("show", `${remote}:upstream.txt`)).toBe("upstream changes")
      expect((await git("rev-list", "--parents", "-n", "1", remote)).split(" ").slice(1)).toEqual([base, upstream])
      return
    }
    expect(remote).toBe(mode === "concurrent-push" ? concurrent : mode === "current" ? upstream : base)
    if (mode === "preview") {
      expect(result.status).toBe("verified")
      return
    }
    if (mode === "check" || mode === "current") {
      expect(result.status).toBe(mode === "check" ? "available" : "current")
      expect(await Bun.file(path.join(root.path, "gate-ran")).exists()).toBe(false)
      return
    }
    expect(result.status).toBe("blocked")
    expect(result.reason).toContain(
      mode === "conflict"
        ? "Merge conflicts"
        : mode === "failed-check"
          ? "Verification failed"
          : "Custom branch changed",
    )
    if (mode !== "concurrent-push") expect((await reconcile(options)).worktree).toBe(result.worktree)
    expect(await Bun.file(path.join(result.worktree!, ".git")).exists()).toBe(true)
  },
  30_000,
)

test("an existing lock and empty verification policy cannot write a remote", async () => {
  await using root = await tmpdir()
  const state = path.join(root.path, "state")
  await mkdir(path.join(state, "lock"), { recursive: true })
  const options = { repo: root.path, state, upstream: "unused", fork: "unused", branch: "unused", gates: [] }
  await expect(reconcile(options)).rejects.toThrow("At least one verification gate")
  await expect(reconcile({ ...options, gates: [{ name: "unused", args: ["unused"] }] })).rejects.toThrow("EEXIST")
  await rmdir(path.join(state, "lock"))
})
