import { hubBranding, hubShell } from "./hub"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const hub = url.hostname === "hub.samijaber.com"
    if (!hub && url.hostname !== "opencode.samijaber.com") return new Response("Not found", { status: 404 })
    // Keep launcher assets at their existing URLs, but update them without restarting the Flow gateway.
    if (
      hub &&
      ["GET", "HEAD"].includes(request.method) &&
      [
        "/site.webmanifest",
        "/favicon.ico",
        "/hub/favicon.ico",
        "/hub/icon.png",
        "/hub/icon-512.png",
        "/hub/apple-touch-icon.png",
      ].includes(url.pathname)
    ) {
      if (url.pathname === "/favicon.ico") url.pathname = "/hub/favicon.ico"
      const asset = await env.ASSETS.fetch(new Request(url, request))
      const response = new Response(asset.body, asset)
      response.headers.set("cache-control", "public, max-age=0, must-revalidate")
      response.headers.set("x-opencode-ui-revision", env.BUILD_SHA)
      return response
    }
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
    if (!hub && url.pathname === "/_opencode/preferences" && request.method === "GET") {
      // Only this storage bridge may be framed by Hub. The application itself retains X-Frame-Options: DENY.
      return new Response('<!doctype html><script type="module" src="/_opencode/preferences.js"></script>', {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; script-src 'self'; frame-ancestors https://hub.samijaber.com",
        },
      })
    }
    // A route (not a Workers Custom Domain) preserves the tunnel origin. Forward the original request
    // and response without buffering: SSE, uploads, cookies and WebSocket upgrades keep their semantics.
    if (
      (hub &&
        (["/flow", "/verification", "/orchestrator", "/orchestrator/", "/opencode", "/opencode/"].includes(
          url.pathname,
        ) ||
          ["/flow/", "/verification/", "/hub/"].some((prefix) => url.pathname.startsWith(prefix)))) ||
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") ||
      url.pathname === "/openapi.json" ||
      request.headers.get("upgrade") ||
      (request.method !== "GET" && request.method !== "HEAD")
    ) {
      const response = await fetch(request)
      if (
        hub &&
        request.method === "GET" &&
        (url.pathname === "/flow/" ||
          /^\/verification(?:\/(?!api(?:\/|$)|assets(?:\/|$)|login(?:\/|$)|auth(?:\/|$)).*)?$/.test(url.pathname)) &&
        response.status === 200 &&
        response.headers.get("content-type")?.includes("text/html") &&
        !response.headers.has("content-disposition")
      ) {
        const branded = new Response(response.body, response)
        branded.headers.delete("etag")
        branded.headers.delete("content-length")
        branded.headers.set("cache-control", "no-cache")
        branded.headers.set("x-opencode-ui-revision", env.BUILD_SHA)
        return hubBranding().transform(branded)
      }
      return response
    }
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
        response.headers.set(
          "content-security-policy",
          `${response.headers.get("content-security-policy") ?? "default-src 'self'"}; frame-src 'self' https://opencode.samijaber.com`,
        )
        response.headers.delete("etag")
        response.headers.delete("content-length")
        return hubShell(response)
      }
    }
    return response
  },
} satisfies ExportedHandler<Env>
