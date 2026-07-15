import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto"

const COOKIE_NAME = "dashboard_session"
const SESSION_SECONDS = 60 * 60 * 24 * 7

function isAuthenticationExplicitlyDisabledForDevelopment() {
  return process.env.NODE_ENV !== "production" && process.env.PANEL_AUTH_DISABLED === "true"
}

export function assertPanelAuthenticationConfiguration() {
  if (isAuthenticationExplicitlyDisabledForDevelopment()) return

  const missing = [
    !process.env.PANEL_PASSWORD_HASH && "PANEL_PASSWORD_HASH",
    !process.env.PANEL_SESSION_SECRET && "PANEL_SESSION_SECRET",
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(`Panel authentication configuration is missing: ${missing.join(", ")}`)
  }
}

export function isAuthEnabled() {
  return !isAuthenticationExplicitlyDisabledForDevelopment()
}

export function hashPanelPassword(password: string, salt = randomBytes(16).toString("base64url")) {
  const hash = scryptSync(password, salt, 64).toString("base64url")
  return `${salt}.${hash}`
}

export function verifyPanelPassword(password: string) {
  const stored = process.env.PANEL_PASSWORD_HASH
  if (!stored) return false

  const [salt, expected] = stored.split(".")
  if (!salt || !expected) return false
  const actual = scryptSync(password, salt, 64).toString("base64url")
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function sign(value: string) {
  const secret = process.env.PANEL_SESSION_SECRET
  if (!secret) throw new Error("PANEL_SESSION_SECRET is required for panel authentication.")
  return createHmac("sha256", secret).update(value).digest("base64url")
}

export function createSessionCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS
  const payload = String(expiresAt)
  const value = `${payload}.${sign(payload)}`
  const secure = process.env.PANEL_COOKIE_SECURE !== "false" ? "; Secure" : ""
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`
}

export function clearSessionCookie() {
  const secure = process.env.PANEL_COOKIE_SECURE !== "false" ? "; Secure" : ""
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function hasValidSession(request: Request) {
  if (!isAuthEnabled()) return true
  const cookie = request.headers.get("cookie") ?? ""
  const value = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1)
  if (!value) return false

  const [payload, signature] = value.split(".")
  if (!payload || !signature || !Number.isInteger(Number(payload)) || Number(payload) < Date.now() / 1000) return false
  const expected = sign(payload)
  const actualBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}
