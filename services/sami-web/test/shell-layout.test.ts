import { expect, test } from "bun:test"
import { chromium } from "@playwright/test"
import { hubShell } from "../src/hub"

// Real browser layout: unlike jsdom, Chromium evaluates the safe-area env() values and inline/CSS cascade.
test("Hub dock, desktop rail and OpenCode titlebars consume safe-area insets exactly once", async () => {
  const browser = await chromium.launch()
  try {
    for (const { top, position, width, height } of [
      { top: 0, position: "top", width: 375, height: 667 },
      { top: 59, position: "top", width: 390, height: 844 },
      { top: 0, position: "bottom", width: 375, height: 560 },
      { top: 59, position: "bottom", width: 390, height: 844 },
      { top: 0, position: "top", width: 1280, height: 800 },
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1000, hasTouch: true })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom: top ? 34 : 0 } })
      // Upstream reserves insets in its titlebar/main. Hub now owns both in its history bar and dock.
      const bottom = position === "bottom"
      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
         *{box-sizing:border-box}#root{display:flex;flex-direction:column}#root>div{flex:1;min-height:0;display:flex}main{flex:1;display:flex;flex-direction:column}section{flex:1}.order-last{order:1}
      </style></head><body><div id="root" data-standalone="${!!top}">
        <header data-slot="titlebar-v2" class="${bottom ? "order-last" : ""}" style="
          flex-shrink:0;
          height:${bottom ? "calc(28px + max(8px,env(safe-area-inset-bottom,0px)))" : "calc(28px + max(8px,min(16px,env(safe-area-inset-top,0px)*1000)) + env(safe-area-inset-top,0px))"};
          padding-top:${bottom ? "0px" : "calc(max(8px,min(16px,env(safe-area-inset-top,0px)*1000)) + env(safe-area-inset-top,0px))"};
          padding-bottom:${bottom ? "env(safe-area-inset-bottom,0px)" : "0px"}
        ">Conversation</header>
        <div><main style="padding-top:${bottom ? "env(safe-area-inset-top,0px)" : "0px"}"><section>Session content</section></main></div>
      </div></body></html>`
      await page.setContent(await hubShell(new Response(html)).text())
      const geometry = await page.evaluate(() => {
        const navigation = document.querySelector("#hub-navigation")!.getBoundingClientRect()
        const history = document.querySelector("#hub-history")!.getBoundingClientRect()
        const header = document.querySelector("[data-slot=titlebar-v2]")!.getBoundingClientRect()
        const content = document.querySelector("section")!.getBoundingClientRect()
        const root = document.querySelector("#root")!.getBoundingClientRect()
        return {
          navigationTop: navigation.top,
          navigationHeight: navigation.height,
          navigationWidth: navigation.width,
          gap: Math.min(header.top, content.top) - history.bottom,
          position: header.top < content.top ? "top" : "bottom",
          headerHeight: header.height,
          bottomPadding: getComputedStyle(document.querySelector("[data-slot=titlebar-v2]")!).paddingBottom,
          rootLeft: root.left,
          rootBottom: root.bottom,
          contentBottom: Math.max(header.bottom, content.bottom),
          dockPadding: getComputedStyle(document.querySelector("#hub-navigation")!).paddingBottom,
        }
      })
      const dock = width < 1000 ? 72 + (top ? 34 : 0) : 0
      expect(geometry).toEqual({
        navigationTop: width < 1000 ? height - dock : 0,
        navigationHeight: width < 1000 ? dock : height,
        navigationWidth: width < 1000 ? width : 112,
        gap: 0,
        position,
        headerHeight: 36,
        bottomPadding: "0px",
        rootLeft: width < 1000 ? 0 : 112,
        rootBottom: height - dock,
        contentBottom: height - dock,
        dockPadding: top ? "34px" : "0px",
      })
      expect(await page.locator("#hub-navigation a").allTextContents()).toEqual([
        "OpenCode",
        "Orchestrator",
        "Flow",
        "Previews",
      ])
      for (const link of await page.locator("#hub-navigation a, #hub-history button").all()) {
        const box = (await link.boundingBox())!
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}, 15_000) // Includes launching an isolated Chromium process, not a timer-based wait.
