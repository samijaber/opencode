export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname !== "opencode.samijaber.com") return new Response("Not found", { status: 404 })
    // A route (not a Workers Custom Domain) preserves the tunnel origin. Forward the original request
    // and response without buffering: SSE, uploads, cookies and WebSocket upgrades keep their semantics.
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/auth/") ||
      url.pathname === "/openapi.json" ||
      request.headers.get("upgrade") ||
      (request.method !== "GET" && request.method !== "HEAD")
    )
      return fetch(request)
    // Cloudflare's existing hostname Access application runs before this Worker and its asset binding.
    // workers.dev and preview URLs are disabled, so there is no second, unprotected frontend endpoint.
    const asset = await env.ASSETS.fetch(request)
    const response = new Response(asset.body, asset)
    response.headers.set("x-opencode-ui-revision", env.BUILD_SHA)
    response.headers.set("referrer-policy", "no-referrer")
    response.headers.set("x-frame-options", "DENY")
    if (response.headers.get("content-type")?.includes("text/html")) response.headers.set("cache-control", "no-cache")
    return response
  },
} satisfies ExportedHandler<Env>
