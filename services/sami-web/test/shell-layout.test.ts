import { expect, test } from "bun:test"
import { chromium } from "@playwright/test"
import { hubShell } from "../src/hub"

// Real browser layout: unlike jsdom, Chromium evaluates the safe-area env() values and inline/CSS cascade.
test("Hub dock, desktop rail and titlebars keep a compact application viewport with safe areas", async () => {
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
      // Hub owns the status-bar inset and the compact bottom edge, including pages using viewport-fit=cover.
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
      const dock = width < 1000 ? 72 : 0
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
        dockPadding: "0px",
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

test("body-portalled session drawers and dialogs stay between Hub bars, with reachable footer actions", async () => {
  const css = await Promise.all(
    [
      "../../../packages/app/src/shell/mobile-drawer.css",
      "../../../packages/app/src/shell/titlebar/titlebar.css",
      "../../../packages/ui/src/overlays/dialog/dialog.css",
    ].map((path) => Bun.file(new URL(path, import.meta.url)).text()),
  )
  const browser = await chromium.launch()
  try {
    for (const width of [375, 390, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 560 },
        hasTouch: true,
        isMobile: width < 1000,
      })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34 } })
      for (const mode of ["drawer", "dialog"]) {
        // These portals deliberately live outside #root, just like the real Corvu and Kobalte portals.
        const portal =
          mode === "drawer"
            ? `
          <div data-slot="mobile-drawer-overlay"></div>
          <div data-slot="mobile-drawer-content">
            <div data-slot="mobile-drawer-handle"><span></span></div>
            <div data-slot="mobile-tabs-drawer">
              <div data-slot="mobile-tabs-drawer-list" data-scrollable>${"<p>Synthetic session</p>".repeat(30)}</div>
              <nav><a href="#home">Home</a></nav>
            </div>
          </div>`
            : `
          <div data-component="dialog-overlay"></div>
          <div data-dialog-layer="0" style="position:fixed;inset:0;z-index:51;display:flex;align-items:center;justify-content:center;pointer-events:none">
            <div data-component="dialog-v2" data-size="x-large"><div data-slot="dialog-container">
              <div data-slot="dialog-content"><div data-slot="dialog-body">Synthetic dialog</div>
              <div data-slot="dialog-footer"><button>Done</button></div></div>
            </div></div>
          </div>`
        await page.setContent(
          await hubShell(
            new Response(`<html><head>
          <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
          <style>${css.join("\n")}*{box-sizing:border-box}a,button{display:block;min-height:44px}#root{overflow:hidden}</style>
          </head><body><div id="root">Application viewport</div><div>${portal}</div></body></html>`),
          ).text(),
        )
        const overlay = mode === "drawer" ? "[data-slot=mobile-drawer-content]" : "[data-slot=dialog-container]"
        const dimensions = await page.locator(overlay).evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const root = document.querySelector("#root")!.getBoundingClientRect()
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, root: root.toJSON() }
        })
        expect(dimensions.top).toBeGreaterThanOrEqual(dimensions.root.top)
        expect(dimensions.bottom).toBeLessThanOrEqual(dimensions.root.bottom)
        expect(dimensions.left).toBeGreaterThanOrEqual(dimensions.root.left)
        expect(dimensions.right).toBeLessThanOrEqual(dimensions.root.right)
        if (mode === "drawer") {
          await page.locator("[data-scrollable]").evaluate((element) => (element.scrollTop = element.scrollHeight))
        }
        const action = page.getByRole(mode === "drawer" ? "link" : "button", {
          name: mode === "drawer" ? "Home" : "Done",
          exact: true,
        })
        await action.tap()
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}, 15_000) // Real Chromium layout, viewport insets and touch hit testing against the shipped overlay CSS.
