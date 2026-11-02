import { shell } from "./hub-shell"

// Only OpenCode-specific integration belongs here. Shared navigation is generated from the installed gateway.
const styles = `
/* Hub owns both safe-area insets. OpenCode must not reserve either again. */
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
