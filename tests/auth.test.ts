import { expect, test } from "bun:test"

import {
  createSessionCookie,
  hasValidSession,
  hashPanelPassword,
  verifyPanelPassword,
} from "../app/lib/auth.server"
import { handleAuthRequest } from "../app/lib/auth-api.server"
import { listPanelAccessLogs } from "../app/lib/db.server"

test("verifies a salted panel password", () => {
  process.env.PANEL_PASSWORD_HASH = hashPanelPassword("correct horse battery staple")
  expect(verifyPanelPassword("correct horse battery staple")).toBe(true)
  expect(verifyPanelPassword("wrong password")).toBe(false)
})

test("creates and validates a signed session cookie", () => {
  process.env.PANEL_SESSION_SECRET = "test-session-secret"
  process.env.PANEL_PASSWORD_HASH = hashPanelPassword("password")
  const cookie = createSessionCookie().split(";")[0]
  expect(hasValidSession(new Request("https://example.test", { headers: { cookie } }))).toBe(true)
  expect(hasValidSession(new Request("https://example.test"))).toBe(false)
})

test("login and logout APIs set secure session cookies", async () => {
  process.env.PANEL_SESSION_SECRET = "test-session-secret"
  process.env.PANEL_PASSWORD_HASH = hashPanelPassword("password")
  const headers = { "x-forwarded-for": `2001:db8:1::${(Date.now() + 1).toString(16).slice(-4)}` }
  const login = await handleAuthRequest(new Request("https://example.test/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "password" }),
  }), "/api/auth/login")
  expect(login.status).toBe(200)
  expect(login.headers.get("set-cookie")).toContain("HttpOnly")
  expect(listPanelAccessLogs().some((log) => log.ip === headers["x-forwarded-for"] && log.event === "login_success")).toBe(true)

  const logout = await handleAuthRequest(new Request("https://example.test/api/auth/logout", { method: "POST", headers }), "/api/auth/logout")
  expect(logout.headers.get("set-cookie")).toContain("Max-Age=0")
})

test("blocks an IP for 24 hours after ten failed password attempts", async () => {
  process.env.PANEL_SESSION_SECRET = "test-session-secret"
  process.env.PANEL_PASSWORD_HASH = hashPanelPassword("password")
  const headers = { "content-type": "application/json", "x-forwarded-for": `2001:db8:2::${Date.now().toString(16).slice(-4)}` }

  for (let attempt = 1; attempt < 10; attempt++) {
    const response = await handleAuthRequest(new Request("https://example.test/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "wrong password" }),
    }), "/api/auth/login")
    expect(response.status).toBe(401)
  }

  const tenthAttempt = await handleAuthRequest(new Request("https://example.test/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ password: "wrong password" }),
  }), "/api/auth/login")
  expect(tenthAttempt.status).toBe(403)

  const blockedSessionCheck = await handleAuthRequest(new Request("https://example.test/api/auth/session", {
    headers,
  }), "/api/auth/session")
  expect(blockedSessionCheck.status).toBe(403)
})
