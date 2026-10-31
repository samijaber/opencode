// Match the installed Flow gateway's Hub shell. Flow and Orchestrator keep using that shell at the origin.
// Colors come from Iradeh packages/design/src/theme.ts; navigation remains flat and touch-sized.
const styles = `
:root{--hub-bar:calc(48px + env(safe-area-inset-top,0px))}
html{scroll-padding-top:var(--hub-bar)}
body{margin:0;padding-top:var(--hub-bar)!important;box-sizing:border-box}
#root{height:calc(100dvh - var(--hub-bar))!important;min-height:0!important}
@media(display-mode:standalone){#root{height:calc(100vh - var(--hub-bar))!important}}
#root[data-standalone=true]{height:calc(100vh - var(--hub-bar))!important}
/* Hub already owns the status-bar inset. OpenCode must not add it a second time in an installed iOS app. */
@media(max-width:767px){body[data-hub-app=opencode] [data-slot=titlebar-v2]:not(.order-last){height:36px!important;padding-top:8px!important}}
#hub-navigation{position:fixed;inset:0 0 auto;z-index:2147483646;box-sizing:border-box;height:var(--hub-bar);padding:env(safe-area-inset-top,0px) max(8px,env(safe-area-inset-right,0px)) 0 max(8px,env(safe-area-inset-left,0px));display:flex;background:#f9f7f2;color:#1c2b26;border-bottom:1px solid currentColor;font:400 .875rem/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;direction:ltr}
#hub-navigation a{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-height:44px;min-width:0;padding:8px 16px;color:inherit;background:transparent;text-align:center;text-decoration:none;border:0;border-bottom:2px solid transparent;border-radius:0;overflow-wrap:anywhere}
#hub-navigation a[aria-current=page]{border-bottom-color:currentColor;font-weight:700}
#hub-navigation a:focus-visible{outline:3px solid currentColor;outline-offset:-4px}
@media(max-width:600px){#hub-navigation a{flex:1;padding-inline:8px}}
@media(prefers-color-scheme:dark){#hub-navigation{background:#12211d;color:#f2f0ea}}
`

export function hubShell(response: Response) {
  return new HTMLRewriter()
    .on('link[rel="manifest"],link[rel="apple-touch-icon"],meta[name="theme-color"]', {
      element(element) {
        element.remove()
      },
    })
    .on("head", {
      element(element) {
        element.append(
          `<link rel="manifest" href="/site.webmanifest" crossorigin="use-credentials"><link rel="apple-touch-icon" href="/hub/icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Hub"><style>${styles}</style>`,
          { html: true },
        )
      },
    })
    .on("body", {
      element(element) {
        element.setAttribute("data-hub-app", "opencode")
        element.prepend(
          '<nav id="hub-navigation" aria-label="Hub applications"><a href="/" rel="external" aria-current="page">OpenCode</a><a href="/verification/" rel="external">Orchestrator</a><a href="/flow/" rel="external">Flow</a></nav>',
          { html: true },
        )
      },
    })
    .transform(response)
}
