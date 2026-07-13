import { resolve } from "node:path"

import { handleAuthRequest } from "./app/lib/auth-api.server"
import { hasValidSession, isAuthEnabled } from "./app/lib/auth.server"
import { handleApiRequest } from "./app/lib/bun-api.server"
import { isIpBlocked, recordPanelAccessLog } from "./app/lib/db.server"
import { blockedIpResponse, getClientIp } from "./app/lib/ip-access.server"
import { startMonitor } from "./app/lib/monitor.service.server"

const clientDirectory = resolve(import.meta.dir, "build/client")
const indexFile = Bun.file(resolve(clientDirectory, "index.html"))

function getStaticFile(pathname: string) {
  const filePath = resolve(clientDirectory, `.${pathname}`)
  return filePath.startsWith(clientDirectory) ? Bun.file(filePath) : null
}

function isStaticAsset(pathname: string) {
  return pathname.startsWith("/assets/") || pathname === "/favicon.ico" || pathname === "/manifest.webmanifest"
}

startMonitor()

const port = Number(process.env.PORT ?? 3000)
Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const ip = getClientIp(request)
    if (isIpBlocked(ip)) {
      recordPanelAccessLog({ ip, event: "ip_blocked", status: "blocked", path: url.pathname })
      return blockedIpResponse(request)
    }
    if (url.pathname.startsWith("/api/auth/")) return handleAuthRequest(request, url.pathname)

    if (isAuthEnabled() && !hasValidSession(request) && !isStaticAsset(url.pathname)) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized." }, { status: 401 })
      }
      if (url.pathname !== "/login") return Response.redirect(new URL("/login", url), 302)
    }

    if (hasValidSession(request) && request.method === "GET" && (url.pathname === "/price-monitoring" || url.pathname === "/access-logs")) {
      recordPanelAccessLog({ ip, event: "panel_access", status: "success", path: url.pathname })
    }

    if (url.pathname.startsWith("/api/")) return handleApiRequest(request, url.pathname)

    if (request.method === "GET" || request.method === "HEAD") {
      const file = getStaticFile(url.pathname)
      if (file && await file.exists()) return new Response(file)
      return new Response(indexFile, { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    return new Response("Method not allowed.", { status: 405 })
  },
})

console.info(`Price Alert is listening on http://localhost:${port}`)
