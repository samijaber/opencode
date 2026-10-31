import { expect, test } from "bun:test"
import { chromium } from "@playwright/test"
import { hubShell } from "../src/hub"

// Real browser layout: unlike jsdom, Chromium evaluates the safe-area env() values and inline/CSS cascade.
test("Hub consumes the status-bar inset exactly once in installed and regular browser layouts", async () => {
  const browser = await chromium.launch()
  try {
    for (const top of [0, 59]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom: top ? 34 : 0 } })
      // The current upstream titlebar owns its own inset when not embedded. Hub owns that inset when embedded.
      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" data-standalone="${!!top}"><header data-slot="titlebar-v2" style="height:calc(28px + max(8px,min(16px,env(safe-area-inset-top,0px)*1000)) + env(safe-area-inset-top,0px));padding-top:calc(max(8px,min(16px,env(safe-area-inset-top,0px)*1000)) + env(safe-area-inset-top,0px));box-sizing:border-box">Conversation</header></div></body></html>`
      await page.setContent(await hubShell(new Response(html)).text())
      const geometry = await page.evaluate(() => {
        const navigation = document.querySelector("#hub-navigation")!.getBoundingClientRect()
        const header = document.querySelector("header")!.getBoundingClientRect()
        return { navigationHeight: navigation.height, gap: header.top - navigation.bottom, headerHeight: header.height }
      })
      expect(geometry).toEqual({ navigationHeight: 48 + top, gap: 0, headerHeight: 36 })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}, 15_000) // Includes launching an isolated Chromium process, not a timer-based wait.
