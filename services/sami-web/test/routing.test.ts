import { afterEach, expect, mock, spyOn, test } from "bun:test"
import worker from "../src/index"

afterEach(() => mock.restore())

function assets() {
  const fetch = mock(
    async () =>
      new Response(
        '<html><head><link rel="manifest" href="/old.webmanifest"><script type="module" src="/_assets/custom.js"></script></head><body><div id="root"></div></body></html>',
        {
          headers: { "content-type": "text/html", etag: '"asset"' },
        },
      ),
  )
  // SAFETY: this fixture implements the only Fetcher method the Worker calls; no network is available to it.
  return { fetch, env: { ASSETS: { fetch } as Fetcher, BUILD_SHA: "development" } }
}

test("both hosts serve the same custom bundle; only Hub adds navigation and keeps its manifest", async () => {
  const fixture = assets()
  const plain = await worker.fetch(
    new Request("https://opencode.samijaber.com/server/test/session/synthetic"),
    fixture.env,
  )
  const hub = await worker.fetch(
    new Request("https://hub.samijaber.com/server/test/session/synthetic", {
      headers: { "if-none-match": '"asset"' },
    }),
    fixture.env,
  )
  expect(plain.headers.get("x-opencode-ui-revision")).toBe("development")
  expect(hub.headers.get("x-opencode-ui-revision")).toBe("development")
  expect(await plain.text()).not.toContain("hub-navigation")
  const html = await hub.text()
  expect(html).toContain("/_assets/custom.js")
  expect(html).toContain('aria-label="Hub applications"')
  expect(html).toContain('href="/flow/"')
  expect(html).toContain('href="/verification/"')
  expect(html).toContain('href="/site.webmanifest"')
  expect(html).not.toContain("old.webmanifest")
  expect(hub.headers.get("etag")).toBeNull()
  expect(hub.headers.get("cache-control")).toBe("no-cache")
})

test.each([
  "/flow",
  "/flow/",
  "/flow/preview/example/index.html",
  "/verification",
  "/verification/dag-runs/example",
  "/verification/api/logs",
  "/site.webmanifest",
  "/hub/icon.png",
  "/opencode",
  "/api/info",
  "/api/event",
  "/auth/connect/example",
  "/openapi.json",
])("Hub %s still reaches the authenticated origin", async (path) => {
  const fixture = assets()
  const origin = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("origin", { headers: { "x-origin": "synthetic" } }),
  )
  const request = new Request(`https://hub.samijaber.com${path}`)
  const response = await worker.fetch(request, fixture.env)
  expect(origin).toHaveBeenCalledWith(request)
  expect(fixture.fetch).not.toHaveBeenCalled()
  expect(response.headers.get("x-origin")).toBe("synthetic")
  expect(await response.text()).toBe("origin")
})

test("Hub shares a network-only push worker across OpenCode, Flow and Orchestrator", async () => {
  const fixture = assets()
  const origin = spyOn(globalThis, "fetch")
  const response = await worker.fetch(new Request("https://hub.samijaber.com/sw.js"), fixture.env)
  expect(response.headers.get("content-type")).toBe("text/javascript")
  expect(response.headers.get("cache-control")).toBe("no-store")
  const script = await response.text()
  expect(script).toContain("importScripts('/push.js')")
  expect(script).toContain("self.clients.claim()")
  expect(script).not.toContain("fetch")
  expect(origin).not.toHaveBeenCalled()
  expect(fixture.fetch).not.toHaveBeenCalled()
})

test("API events remain streaming and mutations are not answered by static assets", async () => {
  const fixture = assets()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const origin = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(stream.readable, { headers: { "content-type": "text/event-stream" } }),
  )
  const response = await worker.fetch(new Request("https://hub.samijaber.com/api/event"), fixture.env)
  const reader = response.body!.getReader()
  const first = writer.write(new TextEncoder().encode("data: first\n\n"))
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n")
  await first
  await writer.close()
  origin.mockResolvedValue(new Response(null, { status: 204 }))
  const mutation = new Request("https://hub.samijaber.com/api/session/synthetic", { method: "POST", body: "{}" })
  expect((await worker.fetch(mutation, fixture.env)).status).toBe(204)
  expect(origin).toHaveBeenLastCalledWith(mutation)
  expect(fixture.fetch).not.toHaveBeenCalled()
})

test("unknown hosts cannot reach either assets or the origin", async () => {
  const fixture = assets()
  const origin = spyOn(globalThis, "fetch")
  expect((await worker.fetch(new Request("https://untrusted.example/"), fixture.env)).status).toBe(404)
  expect(origin).not.toHaveBeenCalled()
  expect(fixture.fetch).not.toHaveBeenCalled()
})
