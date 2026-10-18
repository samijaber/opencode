import { createHash } from "node:crypto"

// Preserve the bundled CLI's CSP, including its only permitted inline script (the theme preloader).
// Cloudflare applies these headers to ASSETS responses before the Worker adds its revision header.
const html = await Bun.file("../../packages/app/dist/index.html").text()
const script = html.match(
  /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(["'])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
)
const hash = script ? ` 'sha256-${createHash("sha256").update(script[2]).digest("base64")}'` : ""
const headers = Bun.file("../../packages/app/dist/_headers")
await Bun.write(
  headers,
  `${await headers.text()}\n/*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; media-src 'self' data:; connect-src * data: blob:; worker-src 'self' blob:\n`,
)
