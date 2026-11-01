import { hubShell } from "./hub"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const hub = url.hostname === "hub.samijaber.com"
    if (!hub && url.hostname !== "opencode.samijaber.com") return new Response("Not found", { status: 404 })
    // Keep one network-only worker for all three Hub apps, adding background push without SPA caching.
    if (hub && url.pathname === "/sw.js" && ["GET", "HEAD"].includes(request.method)) {
      return new Response(
        request.method === "HEAD"
          ? null
          : `importScripts('/push.js');
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));`,
        {
          headers: {
            "content-type": "text/javascript",
            "cache-control": "no-store",
            "x-opencode-ui-revision": env.BUILD_SHA,
          },
        },
      )
    }
    // A route (not a Workers Custom Domain) preserves the tunnel origin. Forward the original request
    // and response without buffering: SSE, uploads, cookies and WebSocket upgrades keep their semantics.
    if (
      (hub &&
        ([
          "/flow",
          "/verification",
          "/orchestrator",
          "/orchestrator/",
          "/opencode",
          "/opencode/",
          "/site.webmanifest",
        ].includes(url.pathname) ||
          ["/flow/", "/verification/", "/hub/"].some((prefix) => url.pathname.startsWith(prefix)))) ||
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") ||
      url.pathname === "/openapi.json" ||
      request.headers.get("upgrade") ||
      (request.method !== "GET" && request.method !== "HEAD")
    )
      return fetch(request)
    // Cloudflare's existing hostname Access application runs before this Worker and its asset binding.
    // workers.dev and preview URLs are disabled, so there is no second, unprotected frontend endpoint.
    const assetRequest = new Request(request)
    // A Hub document has a different shell. Do not let a conditional asset response skip its transformation.
    if (hub) {
      assetRequest.headers.delete("if-none-match")
      assetRequest.headers.delete("if-modified-since")
    }
    const asset = await env.ASSETS.fetch(assetRequest)
    const response = new Response(asset.body, asset)
    response.headers.set("x-opencode-ui-revision", env.BUILD_SHA)
    response.headers.set("referrer-policy", "no-referrer")
    response.headers.set("x-frame-options", "DENY")
    if (response.headers.get("content-type")?.includes("text/html")) {
      response.headers.set("cache-control", "no-cache")
      if (hub && response.status === 200) {
        response.headers.delete("etag")
        response.headers.delete("content-length")
        return hubShell(response)
      }
    }
    return response
  },
} satisfies ExportedHandler<Env>
