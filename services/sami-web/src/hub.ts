import { shell } from "./hub-shell"

// Only OpenCode-specific integration belongs here. Shared navigation is generated from the installed gateway.
const styles = `
/* Portals mount under body, outside #root. Keep them inside the same application viewport. */
body[data-hub-app=opencode] :is([data-slot=mobile-drawer-overlay],[data-component=dialog-overlay],[data-dialog-layer]){
top:var(--hub-bar)!important;right:0!important;bottom:var(--hub-dock)!important;left:var(--hub-rail)!important
}
body[data-hub-app=opencode] [data-dialog-layer]{contain:layout}
body[data-hub-app=opencode] [data-slot=dialog-container]{max-height:100%;max-width:100%}
body[data-hub-app=opencode] [data-slot=mobile-drawer-content]{
bottom:var(--hub-dock)!important;inset-inline-start:var(--hub-rail)!important;
max-height:min(75dvh,calc(100dvh - var(--hub-bar) - var(--hub-dock) - 16px))!important;padding-bottom:12px!important
}
/* Hub reserves the top inset and owns the compact bottom edge. OpenCode must not reserve them again. */
@media(max-width:767px){
body[data-hub-app=opencode] [data-slot=titlebar-v2]:not(.order-last){height:36px!important;padding-top:8px!important}
body[data-hub-app=opencode] [data-slot=titlebar-v2].order-last{height:36px!important;padding-bottom:0!important}
body[data-hub-app=opencode] [data-slot=titlebar-v2].order-last + div > main{padding-top:0!important}
}
`

export function hubShell(response: Response) {
  return hubBranding()
    .on('meta[name="theme-color"]', {
      element(element) {
        element.remove()
      },
    })
    .on("head", {
      element(element) {
        element.append(`${shell.head}<style>${styles}</style>`, { html: true })
      },
    })
    .on("body", {
      element(element) {
        element.setAttribute("data-hub-app", "opencode")
        element.prepend(shell.body, { html: true })
        element.append(shell.footer, { html: true })
      },
    })
    .transform(response)
}

// Share the selected Hub artwork with origin-served Flow and Orchestrator without replacing their shell.
export function hubBranding() {
  return new HTMLRewriter()
    .on('link[rel="manifest"],link[rel="apple-touch-icon"],link[rel~="icon"]', {
      element(element) {
        element.remove()
      },
    })
    .on("head", {
      element(element) {
        element.append(
          '<link rel="manifest" href="/site.webmanifest" crossorigin="use-credentials"><link rel="icon" type="image/x-icon" href="/hub/favicon.ico?v=1"><link rel="apple-touch-icon" sizes="180x180" href="/hub/apple-touch-icon.png?v=1">',
          { html: true },
        )
      },
    })
}
