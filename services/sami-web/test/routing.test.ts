import { afterEach, expect, mock, spyOn, test } from "bun:test"
import worker from "../src/index"

afterEach(() => mock.restore())

function assets() {
  const fetch = mock(async (request: Request) => {
    const file = Bun.file(new URL(`../assets${new URL(request.url).pathname}`, import.meta.url))
    if (await file.exists()) return new Response(file, { headers: { "content-type": file.type } })
    return new Response(
      '<html><head><link rel="manifest" href="/old.webmanifest"><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/old.png"><script type="module" src="/_assets/custom.js"></script></head><body><div id="root"></div></body></html>',
      {
        headers: { "content-type": "text/html", etag: '"asset"' },
      },
    )
  })
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
  const canonical = await plain.text()
  expect(canonical).not.toContain("hub-navigation")
  expect(canonical).toContain('href="/old.ico"')
  const html = await hub.text()
  expect(html).toContain("/_assets/custom.js")
  expect(html).toContain('aria-label="Hub applications"')
  expect(html).toContain('href="/flow/"')
  expect(html).toContain('href="/verification"')
  expect(html).toContain('href="/previews/"')
  expect(html).toContain('id="hub-back"')
  expect(html).toContain('src="/hub/navigation.js"')
  expect(html).toContain('href="/site.webmanifest"')
  expect(html).not.toContain("old.webmanifest")
  expect(html).not.toContain("/old.ico")
  expect(html).not.toContain("/old.png")
  expect(html).toContain('href="/hub/favicon.ico?v=1"')
  expect(html).toContain('sizes="180x180" href="/hub/apple-touch-icon.png?v=1"')
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
  "/previews",
  "/previews/",
  "/previews/synthetic",
  "/hub/navigation.js",
  "/hub/legacy-asset.png",
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

test("Hub serves the selected launcher assets and manifest without contacting the gateway", async () => {
  const fixture = assets()
  const origin = spyOn(globalThis, "fetch")
  const manifest = await worker.fetch(new Request("https://hub.samijaber.com/site.webmanifest"), fixture.env)
  const body = await manifest.json()
  expect(body).toMatchObject({ id: "/", name: "Hub", start_url: "/", scope: "/", display: "standalone" })
  expect(body.icons).toEqual([
    { src: "/hub/icon.png?v=1", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/hub/icon-512.png?v=1", sizes: "512x512", type: "image/png", purpose: "any" },
  ])
  for (const [path, size] of [
    ["/hub/apple-touch-icon.png?v=1", 180],
    ["/hub/icon.png?v=1", 192],
    ["/hub/icon-512.png?v=1", 512],
  ] as const) {
    const response = await worker.fetch(new Request(`https://hub.samijaber.com${path}`), fixture.env)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("image/png")
    expect(response.headers.get("x-opencode-ui-revision")).toBe("development")
    const png = new DataView(await response.arrayBuffer())
    expect(png.getUint32(0)).toBe(0x89504e47)
    expect([png.getUint32(16), png.getUint32(20)]).toEqual([size, size])
  }
  for (const path of ["/favicon.ico", "/hub/favicon.ico?v=1"]) {
    const response = await worker.fetch(new Request(`https://hub.samijaber.com${path}`), fixture.env)
    const ico = new DataView(await response.arrayBuffer())
    expect(ico.getUint16(2, true)).toBe(1)
    expect(ico.getUint16(4, true)).toBe(3)
    expect([ico.getUint8(6), ico.getUint8(22), ico.getUint8(38)]).toEqual([16, 32, 48])
  }
  expect(origin).not.toHaveBeenCalled()
})

test.each(["/flow/", "/verification/", "/verification/dags/synthetic"])(
  "Hub %s shares the new branding without replacing its origin shell",
  async (path) => {
    const fixture = assets()
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        '<html><head><link rel="icon" href="/old.ico"><link rel="apple-touch-icon" href="/old.png"><link rel="manifest" href="/old.webmanifest"></head><body><nav id="hub-navigation">Existing navigation</nav><main>Origin application</main></body></html>',
        { headers: { "content-type": "text/html", etag: '"origin"', "content-length": "100" } },
      ),
    )
    const response = await worker.fetch(new Request(`https://hub.samijaber.com${path}`), fixture.env)
    const html = await response.text()
    expect(html).toContain('href="/hub/favicon.ico?v=1"')
    expect(html).toContain('href="/hub/apple-touch-icon.png?v=1"')
    expect(html).not.toContain("/old.")
    expect(html.match(/id="hub-navigation"/g)).toHaveLength(1)
    expect(html).toContain("Origin application")
    expect(response.headers.get("etag")).toBeNull()
    expect(response.headers.get("content-length")).toBeNull()
    expect(fixture.fetch).not.toHaveBeenCalled()
  },
)

test("Hub leaves preview documents and non-document origin responses untouched", async () => {
  const fixture = assets()
  const origin = spyOn(globalThis, "fetch")
  for (const [path, response] of [
    [
      "/flow/preview/example/index.html",
      new Response("<html>Preview</html>", { headers: { "content-type": "text/html" } }),
    ],
    ["/verification/api/logs", new Response("data: synthetic", { headers: { "content-type": "text/event-stream" } })],
    ["/flow/", new Response(null, { status: 302, headers: { location: "/login" } })],
    [
      "/verification/",
      new Response("Download", { headers: { "content-type": "text/html", "content-disposition": "attachment" } }),
    ],
  ] as const) {
    origin.mockResolvedValue(response)
    expect(await worker.fetch(new Request(`https://hub.samijaber.com${path}`), fixture.env)).toBe(response)
  }
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
