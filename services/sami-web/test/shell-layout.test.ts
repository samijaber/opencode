import { expect, test } from "bun:test"
import { chromium } from "@playwright/test"
import { hubShell } from "../src/hub"

// Real browser layout: unlike jsdom, Chromium evaluates the safe-area env() values and inline/CSS cascade.
test("Hub top and bottom navigation consume the status-bar inset exactly once", async () => {
  const browser = await chromium.launch()
  try {
    for (const { top, position, width } of [
      { top: 0, position: "top", width: 390 },
      { top: 59, position: "top", width: 390 },
      { top: 0, position: "bottom", width: 375 },
      { top: 59, position: "bottom", width: 390 },
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top, bottom: top ? 34 : 0 } })
      // Upstream reserves the top inset in the header, or in main when the header moves to the bottom.
      // This fixture exercises Hub's CSS against both inline styles and preserves the bottom home-indicator inset.
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
        const header = document.querySelector("header")!.getBoundingClientRect()
        const content = document.querySelector("section")!.getBoundingClientRect()
        return {
          navigationHeight: navigation.height,
          gap: (header.top < content.top ? header.top : content.top) - navigation.bottom,
          position: header.top < content.top ? "top" : "bottom",
          headerHeight: header.height,
          bottomPadding: getComputedStyle(document.querySelector("header")!).paddingBottom,
          rootBottom: document.querySelector("#root")!.getBoundingClientRect().bottom,
          contentBottom: Math.max(header.bottom, content.bottom),
        }
      })
      expect(geometry).toEqual({
        navigationHeight: 48 + top,
        gap: 0,
        position,
        headerHeight: bottom && top ? 62 : 36,
        bottomPadding: bottom && top ? "34px" : "0px",
        rootBottom: 844,
        contentBottom: 844,
      })
      await context.close()
    }
  } finally {
    await browser.close()
  }
}, 15_000) // Includes launching an isolated Chromium process, not a timer-based wait.
