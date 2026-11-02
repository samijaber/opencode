import { test } from "bun:test"
import { chromium, expect, webkit } from "@playwright/test"
import worker from "../src/index"

// Owns the cross-origin contract: the old build never imports or propagates these preferences.
test.each([chromium, webkit])(
  "%s shares canonical preferences without sharing drafts or credentials",
  async (engine) => {
    const client = await Bun.build({
      entrypoints: ["../../packages/app/src/runtime/persistence/shared.ts"],
      target: "browser",
    })
    const script = await client.outputs[0].text()
    const events = await Bun.build({ entrypoints: ["../../packages/util/src/storage-events.ts"], target: "browser" })
    const eventScript = await events.outputs[0].text()
    const browser = await engine.launch()
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const canonical = "https://opencode.samijaber.com"
    const hub = "https://hub.samijaber.com"
    const tabs = "opencode.window.browser.dat:tabs"
    const settings = JSON.stringify({ appearance: { tabLayout: "vertical", fontSize: 16 } })
    const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">import { initializeSharedPreferences } from '/client.js'; await initializeSharedPreferences(); document.querySelector('#root').textContent = 'ready';</script>`
    try {
      await context.route("https://*.samijaber.com/**", async (route) => {
        const request = new Request(route.request().url())
        // Shared history is gateway-owned; this preference-only fixture must not contact the real origin.
        if (new URL(request.url).pathname === "/hub/navigation.js") {
          await route.fulfill({ contentType: "text/javascript", body: "" })
          return
        }
        const response = await worker.fetch(request, {
          BUILD_SHA: "test",
          // SAFETY: the test asset binding only needs fetch; all content is synthetic and no network is permitted.
          ASSETS: {
            fetch: async (request: Request) => {
              const path = new URL(request.url).pathname
              if (path === "/client.js") return new Response(script, { headers: { "content-type": "text/javascript" } })
              if (path === "/storage-events.js")
                return new Response(eventScript, { headers: { "content-type": "text/javascript" } })
              if (path === "/_opencode/preferences.js") {
                return new Response(`${script}\nserveSharedPreferences();`, {
                  headers: { "content-type": "text/javascript" },
                })
              }
              return new Response(path === "/seed" ? "<!doctype html>" : html, {
                headers: {
                  "content-type": "text/html",
                  "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'",
                },
              })
            },
          } as Fetcher,
        })
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        })
      })
      const source = await context.newPage()
      await source.goto(canonical + "/seed")
      await source.evaluate(
        ({ settings, tabs, canonical }) => {
          localStorage.setItem("settings.v3", settings)
          localStorage.setItem("opencode-theme-id", "nightowl")
          localStorage.setItem("private-password", "synthetic-secret")
          localStorage.setItem(
            tabs,
            JSON.stringify([
              { type: "session", server: canonical, sessionId: "ses_synthetic" },
              { type: "draft", server: canonical, draftID: "canonical-draft", directory: "/synthetic" },
            ]),
          )
        },
        { settings, tabs, canonical },
      )
      const target = await context.newPage()
      await target.goto(hub + "/seed")
      await target.evaluate(
        ({ tabs, hub }) => {
          localStorage.setItem("settings.v3", JSON.stringify({ appearance: { tabLayout: "horizontal" } }))
          localStorage.setItem(
            tabs,
            JSON.stringify([{ type: "draft", server: hub, draftID: "hub-draft", directory: "/synthetic" }]),
          )
          localStorage.setItem("draft-text", "Keep my draft")
        },
        { tabs, hub },
      )
      await target.goto(hub)
      await expect.poll(() => target.locator("#root").textContent()).toBe("ready")
      expect(await target.evaluate(() => localStorage.getItem("settings.v3"))).toBe(settings)
      expect(await target.evaluate(() => localStorage.getItem("opencode-theme-id"))).toBe("nightowl")
      expect(await target.evaluate(() => localStorage.getItem("private-password"))).toBeNull()
      expect(await target.evaluate(() => localStorage.getItem("draft-text"))).toBe("Keep my draft")
      expect(await target.evaluate((tabs) => JSON.parse(localStorage.getItem(tabs)!), tabs)).toEqual([
        { type: "session", server: hub, sessionId: "ses_synthetic" },
        { type: "draft", server: hub, draftID: "hub-draft", directory: "/synthetic" },
      ])
      expect(
        await target.evaluate(() => JSON.parse(localStorage.getItem("opencode.preferences.backup.v1")!)["settings.v3"]),
      ).toContain("horizontal")

      // Drive the real write notification used by app persistence and theme controls.
      await target.evaluate(async () => {
        const { notifyStorageWrite } = await import("/storage-events.js")
        localStorage.setItem("settings.v3", '{"appearance":{"tabLayout":"horizontal"}}')
        notifyStorageWrite("settings.v3", localStorage.getItem("settings.v3"))
      })
      await expect.poll(() => source.evaluate(() => localStorage.getItem("settings.v3"))).toContain("horizontal")
      await source.evaluate(() => localStorage.setItem("opencode-color-scheme", "light"))
      await expect.poll(() => target.evaluate(() => localStorage.getItem("opencode-color-scheme"))).toBe("light")
      await target.reload()
      await expect.poll(() => target.locator("#root").textContent()).toBe("ready")
      expect(await target.evaluate(() => localStorage.getItem("settings.v3"))).toContain("horizontal")

      // A same-origin window other than the authenticated canonical frame cannot impersonate it.
      await target.evaluate(() =>
        window.postMessage(
          {
            protocol: "opencode-preferences-v1",
            values: { "settings.v3": "spoofed" },
          },
          location.origin,
        ),
      )
      expect(await target.evaluate(() => localStorage.getItem("settings.v3"))).not.toBe("spoofed")

      // Expired Access/offline must not block Hub or discard edits made before the next handshake.
      await context.route(canonical + "/_opencode/preferences", (route) => route.abort())
      await target.clock.install()
      await target.reload()
      await target.clock.runFor(2500)
      await expect.poll(() => target.locator("#root").textContent()).toBe("ready")
      await target.evaluate(async () => {
        const { notifyStorageWrite } = await import("/storage-events.js")
        localStorage.setItem("settings.v3", '{"appearance":{"tabLayout":"vertical","fontSize":20}}')
        notifyStorageWrite("settings.v3", localStorage.getItem("settings.v3"))
      })
      await target.reload()
      await target.clock.runFor(2500)
      await expect.poll(() => target.locator("#root").textContent()).toBe("ready")
      await context.unroute(canonical + "/_opencode/preferences")
      await target.reload()
      await expect.poll(() => source.evaluate(() => localStorage.getItem("settings.v3"))).toContain('"fontSize":20')
      expect(await target.evaluate(() => localStorage.getItem("settings.v3"))).toContain('"fontSize":20')
      await expect.poll(() => target.evaluate(() => localStorage.getItem("opencode.preferences.pending.v1"))).toBeNull()
    } finally {
      await context.close()
      await browser.close()
    }
  },
  20_000,
) // Two isolated browser processes and document navigations; no fixed sleeps.
