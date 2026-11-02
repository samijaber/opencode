import { $ } from "bun"

// These zone-owned exclusions are not representable in Wrangler's Worker routes.
// Keep API traffic on the authenticated tunnel origin, without invoking a Worker.
const config = await Bun.file(new URL("./origin-routes.json", import.meta.url)).json()
const auth = await $`bunx wrangler auth token --json`.quiet().json()
const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${config.zone_id}/workers/routes`, {
  headers: { Authorization: `Bearer ${auth.token}` },
})
if (!response.ok) throw new Error(`Cannot check origin routes: HTTP ${response.status}`)
const body = await response.json()
if (!body.success) throw new Error("Cannot check origin routes with the current Cloudflare identity")
const missing = config.patterns.filter(
  (pattern) => !body.result.some((route) => route.pattern === pattern && route.script === null),
)
if (missing.length) throw new Error(`API origin exclusions are missing or assigned to a Worker: ${missing.join(", ")}`)
console.log(`Verified ${config.patterns.length} API routes bypass Workers; tunnel authentication is unchanged.`)
