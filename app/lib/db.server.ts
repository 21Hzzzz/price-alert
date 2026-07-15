import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { Database } from "bun:sqlite"

import type {
  AlertDirection,
  AlertRule,
  AlertTriggerType,
  AccessLogEvent,
  FwAlertSettingsStatus,
  NotificationChannel,
  PanelAccessLog,
  SpotMarket,
  TelegramSettingsStatus,
} from "~/lib/price-alert.types"
import {
  decryptSecret,
  isEncryptionReady,
} from "~/lib/crypto.server"

const databasePath = process.env.DASHBOARD_DB_PATH ?? "./data/dashboard.sqlite"
mkdirSync(dirname(databasePath), { recursive: true })

const db = new Database(databasePath, { create: true })
db.run("PRAGMA journal_mode = WAL")
db.run(`
  CREATE TABLE IF NOT EXISTS telegram_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_token TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)
db.run(`
  CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market TEXT NOT NULL DEFAULT 'binance' CHECK (market IN ('binance', 'okx')),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
    trigger_type TEXT NOT NULL DEFAULT 'target',
    target_price TEXT NOT NULL,
    interval TEXT,
    interval_reset_range TEXT NOT NULL DEFAULT '0',
    interval_suppressions TEXT NOT NULL DEFAULT '[]',
    basket_members TEXT NOT NULL DEFAULT '[]',
    deviation_percent TEXT,
    basket_breaches TEXT NOT NULL DEFAULT '[]',
    channels TEXT NOT NULL DEFAULT '["telegram"]',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_price TEXT,
    last_triggered_at TEXT,
    last_phone_triggered_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)
db.run(`
  CREATE TABLE IF NOT EXISTS fwalert_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    encrypted_url TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`)
db.run(`
  CREATE TABLE IF NOT EXISTS auth_login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    occurred_at INTEGER NOT NULL
  )
`)
db.run("CREATE INDEX IF NOT EXISTS auth_login_attempts_ip_occurred_at ON auth_login_attempts (ip, occurred_at)")
db.run(`
  CREATE TABLE IF NOT EXISTS auth_ip_blocks (
    ip TEXT PRIMARY KEY,
    blocked_until INTEGER NOT NULL
  )
`)
db.run(`
  CREATE TABLE IF NOT EXISTS panel_access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`)
db.run("CREATE INDEX IF NOT EXISTS panel_access_logs_created_at ON panel_access_logs (created_at DESC)")

const ruleColumns = db.query<{ name: string }, []>("PRAGMA table_info(alert_rules)").all()
if (!ruleColumns.some((column) => column.name === "channels")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN channels TEXT NOT NULL DEFAULT '[\"telegram\"]'")
}
if (!ruleColumns.some((column) => column.name === "last_phone_triggered_at")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN last_phone_triggered_at TEXT")
}
if (!ruleColumns.some((column) => column.name === "trigger_type")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'target'")
}
if (!ruleColumns.some((column) => column.name === "interval")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN interval TEXT")
}
if (!ruleColumns.some((column) => column.name === "interval_reset_range")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN interval_reset_range TEXT NOT NULL DEFAULT '0'")
}
if (!ruleColumns.some((column) => column.name === "interval_suppressions")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN interval_suppressions TEXT NOT NULL DEFAULT '[]'")
}
if (!ruleColumns.some((column) => column.name === "market")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN market TEXT NOT NULL DEFAULT 'binance'")
}
if (!ruleColumns.some((column) => column.name === "basket_members")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN basket_members TEXT NOT NULL DEFAULT '[]'")
}
if (!ruleColumns.some((column) => column.name === "deviation_percent")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN deviation_percent TEXT")
}
if (!ruleColumns.some((column) => column.name === "basket_breaches")) {
  db.run("ALTER TABLE alert_rules ADD COLUMN basket_breaches TEXT NOT NULL DEFAULT '[]'")
}

const ruleTableSql = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'alert_rules'").get()?.sql ?? ""
if (/CHECK\s*\(\s*trigger_type\s+IN\s*\(\s*'target'\s*,\s*'interval'\s*\)\s*\)/i.test(ruleTableSql)) {
  db.run("BEGIN")
  try {
    db.run("ALTER TABLE alert_rules RENAME TO alert_rules_legacy")
    db.run(`
      CREATE TABLE alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market TEXT NOT NULL DEFAULT 'binance' CHECK (market IN ('binance', 'okx')),
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('above', 'below')),
        trigger_type TEXT NOT NULL DEFAULT 'target',
        target_price TEXT NOT NULL,
        interval TEXT,
        interval_reset_range TEXT NOT NULL DEFAULT '0',
        interval_suppressions TEXT NOT NULL DEFAULT '[]',
        basket_members TEXT NOT NULL DEFAULT '[]',
        deviation_percent TEXT,
        basket_breaches TEXT NOT NULL DEFAULT '[]',
        channels TEXT NOT NULL DEFAULT '["telegram"]',
        enabled INTEGER NOT NULL DEFAULT 1,
        last_price TEXT,
        last_triggered_at TEXT,
        last_phone_triggered_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    db.run(`
      INSERT INTO alert_rules (
        id, market, symbol, direction, trigger_type, target_price, interval, interval_reset_range,
        interval_suppressions, basket_members, deviation_percent, basket_breaches, channels, enabled,
        last_price, last_triggered_at, last_phone_triggered_at, last_error, created_at, updated_at
      )
      SELECT
        id, market, symbol, direction, trigger_type, target_price, interval, interval_reset_range,
        interval_suppressions, basket_members, deviation_percent, basket_breaches, channels, enabled,
        last_price, last_triggered_at, last_phone_triggered_at, last_error, created_at, updated_at
      FROM alert_rules_legacy
    `)
    db.run("DROP TABLE alert_rules_legacy")
    db.run("COMMIT")
  } catch (error) {
    db.run("ROLLBACK")
    throw error
  }
}

type RuleRow = {
  id: number
  market: string
  symbol: string
  direction: AlertDirection
  trigger_type: string
  target_price: string
  interval: string | null
  interval_reset_range: string
  interval_suppressions: string
  basket_members: string
  deviation_percent: string | null
  basket_breaches: string
  channels: string
  enabled: number
  last_price: string | null
  last_triggered_at: string | null
  last_phone_triggered_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function toRule(row: RuleRow): AlertRule {
  let channels: NotificationChannel[] = ["telegram"]
  let intervalSuppressions: string[] = []
  let basketMembers: Array<{ market: SpotMarket; symbol: string }> = []
  let basketBreaches: string[] = []
  try {
    const parsed = JSON.parse(row.channels) as unknown
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(
        (channel): channel is NotificationChannel => channel === "telegram" || channel === "phone"
      )
      if (valid.length > 0) channels = valid
    }
  } catch {
    // Legacy rows retain Telegram as their default notification channel.
  }
  try {
    const parsed = JSON.parse(row.interval_suppressions) as unknown
    if (Array.isArray(parsed)) {
      intervalSuppressions = parsed.filter((level): level is string => typeof level === "string")
    }
  } catch {
    // Legacy rows have no active interval-level suppressions.
  }
  try {
    const parsed = JSON.parse(row.basket_members) as unknown
    if (Array.isArray(parsed)) {
      basketMembers = parsed.flatMap((member) => {
        if (!member || typeof member !== "object") return []
        const { market, symbol } = member as { market?: unknown; symbol?: unknown }
        return (market === "binance" || market === "okx") && typeof symbol === "string" && symbol.length > 0
          ? [{ market, symbol }]
          : []
      })
    }
  } catch {
    // Legacy rows have no basket members.
  }
  try {
    const parsed = JSON.parse(row.basket_breaches) as unknown
    if (Array.isArray(parsed)) basketBreaches = parsed.filter((key): key is string => typeof key === "string")
  } catch {
    // Legacy rows have no active basket breaches.
  }
  return {
    id: row.id,
    market: row.market === "okx" ? "okx" : "binance",
    symbol: row.symbol,
    triggerType: row.trigger_type === "interval" || row.trigger_type === "basket" ? row.trigger_type : "target",
    direction: row.direction,
    targetPrice: row.target_price,
    interval: row.interval,
    intervalResetRange: row.interval_reset_range,
    intervalSuppressions,
    basketMembers,
    deviationPercent: row.deviation_percent,
    basketBreaches,
    channels,
    enabled: Boolean(row.enabled),
    lastPrice: row.last_price,
    lastTriggeredAt: row.last_triggered_at,
    lastPhoneTriggeredAt: row.last_phone_triggered_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listRules(): AlertRule[] {
  return db
    .query<RuleRow, []>("SELECT * FROM alert_rules ORDER BY created_at DESC")
    .all()
    .map(toRule)
}

export function getRule(id: number) {
  const row = db
    .query<RuleRow, [number]>("SELECT * FROM alert_rules WHERE id = ?")
    .get(id)
  return row ? toRule(row) : null
}

export function createRule(input: {
  market: SpotMarket
  symbol: string
  triggerType: AlertTriggerType
  direction: AlertDirection
  targetPrice: string
  interval: string | null
  intervalResetRange: string
  basketMembers: Array<{ market: SpotMarket; symbol: string }>
  deviationPercent: string | null
  channels: NotificationChannel[]
  enabled?: boolean
}) {
  const now = new Date().toISOString()
  const result = db
    .query(
      `INSERT INTO alert_rules (market, symbol, direction, trigger_type, target_price, interval, interval_reset_range, basket_members, deviation_percent, channels, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.market, input.symbol, input.direction, input.triggerType, input.targetPrice, input.interval, input.intervalResetRange, JSON.stringify(input.basketMembers), input.deviationPercent, JSON.stringify(input.channels), Number(input.enabled ?? true), now, now)
  return getRule(Number(result.lastInsertRowid))!
}

export function updateRule(
  id: number,
  input: Partial<{
    market: SpotMarket
    symbol: string
    triggerType: AlertTriggerType
    direction: AlertDirection
    targetPrice: string
    interval: string | null
    intervalResetRange: string
    basketMembers: Array<{ market: SpotMarket; symbol: string }>
    deviationPercent: string | null
    channels: NotificationChannel[]
    enabled: boolean
  }>
) {
  const existing = getRule(id)
  if (!existing) return null

  const market = input.market ?? existing.market
  const symbol = input.symbol ?? existing.symbol
  const triggerType = input.triggerType ?? existing.triggerType
  const direction = input.direction ?? existing.direction
  const targetPrice = input.targetPrice ?? existing.targetPrice
  const interval = "interval" in input ? input.interval ?? null : existing.interval
  const intervalResetRange = input.intervalResetRange ?? existing.intervalResetRange
  const basketMembers = input.basketMembers ?? existing.basketMembers
  const deviationPercent = "deviationPercent" in input ? input.deviationPercent ?? null : existing.deviationPercent
  const channels = input.channels ?? existing.channels
  const enabled = input.enabled ?? existing.enabled
  db.query(
    `UPDATE alert_rules
     SET market = ?, symbol = ?, direction = ?, trigger_type = ?, target_price = ?, interval = ?, interval_reset_range = ?, basket_members = ?, deviation_percent = ?, channels = ?, enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(market, symbol, direction, triggerType, targetPrice, interval, intervalResetRange, JSON.stringify(basketMembers), deviationPercent, JSON.stringify(channels), Number(enabled), new Date().toISOString(), id)
  return getRule(id)
}

export function deleteRule(id: number) {
  return db.query("DELETE FROM alert_rules WHERE id = ?").run(id).changes > 0
}

export function updateRuleMarketState(
  id: number,
  input: { lastPrice: string; lastTriggeredAt?: string | null; lastPhoneTriggeredAt?: string | null; lastError?: string | null; intervalSuppressions?: string[]; basketBreaches?: string[] }
) {
  db.query(
    `UPDATE alert_rules
     SET last_price = ?, last_triggered_at = COALESCE(?, last_triggered_at),
         last_phone_triggered_at = COALESCE(?, last_phone_triggered_at),
         interval_suppressions = COALESCE(?, interval_suppressions),
         basket_breaches = COALESCE(?, basket_breaches),
         last_error = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    input.lastPrice,
    input.lastTriggeredAt ?? null,
    input.lastPhoneTriggeredAt ?? null,
    input.intervalSuppressions === undefined ? null : JSON.stringify(input.intervalSuppressions),
    input.basketBreaches === undefined ? null : JSON.stringify(input.basketBreaches),
    input.lastError ?? null,
    new Date().toISOString(),
    id
  )
}

export function getTelegramSettingsStatus(): TelegramSettingsStatus {
  const row = db
    .query<{ encrypted_token: string; chat_id: string; updated_at: string }, []>(
      "SELECT encrypted_token, chat_id, updated_at FROM telegram_settings WHERE id = 1"
    )
    .get()

  return {
    configured: Boolean(row),
    chatId: row?.chat_id ?? null,
    token: null,
    updatedAt: row?.updated_at ?? null,
    encryptionReady: isEncryptionReady(),
  }
}

export async function getTelegramSettingsStatusWithSecret(): Promise<TelegramSettingsStatus> {
  const row = db
    .query<{ encrypted_token: string; chat_id: string; updated_at: string }, []>(
      "SELECT encrypted_token, chat_id, updated_at FROM telegram_settings WHERE id = 1"
    )
    .get()
  if (!row) return getTelegramSettingsStatus()

  try {
    return {
      configured: true,
      chatId: row.chat_id,
      token: await decryptSecret(row.encrypted_token),
      updatedAt: row.updated_at,
      encryptionReady: isEncryptionReady(),
    }
  } catch {
    return {
      configured: true,
      chatId: row.chat_id,
      token: null,
      updatedAt: row.updated_at,
      encryptionReady: isEncryptionReady(),
    }
  }
}

export function saveTelegramSettings(encryptedToken: string, chatId: string) {
  const now = new Date().toISOString()
  db.query(
    `INSERT INTO telegram_settings (id, encrypted_token, chat_id, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET encrypted_token = excluded.encrypted_token,
       chat_id = excluded.chat_id, updated_at = excluded.updated_at`
  ).run(encryptedToken, chatId, now)
}

export function getEncryptedTelegramSettings() {
  return db
    .query<{ encrypted_token: string; chat_id: string }, []>(
      "SELECT encrypted_token, chat_id FROM telegram_settings WHERE id = 1"
    )
    .get()
}

export function getFwAlertSettingsStatus(): FwAlertSettingsStatus {
  const row = db
    .query<{ encrypted_url: string; updated_at: string }, []>(
      "SELECT encrypted_url, updated_at FROM fwalert_settings WHERE id = 1"
    )
    .get()
  return {
    configured: Boolean(row),
    url: null,
    updatedAt: row?.updated_at ?? null,
    encryptionReady: isEncryptionReady(),
  }
}

export async function getFwAlertSettingsStatusWithSecret(): Promise<FwAlertSettingsStatus> {
  const row = db
    .query<{ encrypted_url: string; updated_at: string }, []>(
      "SELECT encrypted_url, updated_at FROM fwalert_settings WHERE id = 1"
    )
    .get()
  if (!row) return getFwAlertSettingsStatus()

  try {
    return {
      configured: true,
      url: await decryptSecret(row.encrypted_url),
      updatedAt: row.updated_at,
      encryptionReady: isEncryptionReady(),
    }
  } catch {
    return {
      configured: true,
      url: null,
      updatedAt: row.updated_at,
      encryptionReady: isEncryptionReady(),
    }
  }
}

export function saveFwAlertSettings(encryptedUrl: string) {
  const now = new Date().toISOString()
  db.query(
    `INSERT INTO fwalert_settings (id, encrypted_url, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET encrypted_url = excluded.encrypted_url,
       updated_at = excluded.updated_at`
  ).run(encryptedUrl, now)
}

export function getEncryptedFwAlertSettings() {
  return db
    .query<{ encrypted_url: string }, []>(
      "SELECT encrypted_url FROM fwalert_settings WHERE id = 1"
    )
    .get()
}

const LOGIN_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1_000
const LOGIN_FAILURE_LIMIT = 10

export function isIpBlocked(ip: string, now = Date.now()) {
  db.query("DELETE FROM auth_ip_blocks WHERE blocked_until <= ?").run(now)
  return Boolean(
    db.query<{ ip: string }, [string, number]>(
      "SELECT ip FROM auth_ip_blocks WHERE ip = ? AND blocked_until > ?"
    ).get(ip, now)
  )
}

export function recordFailedLogin(ip: string, now = Date.now()) {
  const windowStart = now - LOGIN_FAILURE_WINDOW_MS
  db.query("DELETE FROM auth_login_attempts WHERE occurred_at <= ?").run(windowStart)
  db.query("INSERT INTO auth_login_attempts (ip, occurred_at) VALUES (?, ?)").run(ip, now)

  const attempts = db
    .query<{ count: number }, [string, number]>(
      "SELECT COUNT(*) AS count FROM auth_login_attempts WHERE ip = ? AND occurred_at > ?"
    )
    .get(ip, windowStart)?.count ?? 0

  if (attempts < LOGIN_FAILURE_LIMIT) return false

  db.query(
    `INSERT INTO auth_ip_blocks (ip, blocked_until) VALUES (?, ?)
     ON CONFLICT(ip) DO UPDATE SET blocked_until = excluded.blocked_until`
  ).run(ip, now + LOGIN_FAILURE_WINDOW_MS)
  db.query("DELETE FROM auth_login_attempts WHERE ip = ?").run(ip)
  return true
}

export function clearFailedLogins(ip: string) {
  db.query("DELETE FROM auth_login_attempts WHERE ip = ?").run(ip)
}

type PanelAccessLogRow = {
  id: number
  ip: string
  event: AccessLogEvent
  status: "success" | "failure" | "blocked"
  path: string
  created_at: string
}

export function recordPanelAccessLog(input: {
  ip: string
  event: AccessLogEvent
  status: "success" | "failure" | "blocked"
  path: string
}) {
  db.query(
    "INSERT INTO panel_access_logs (ip, event, status, path, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(input.ip, input.event, input.status, input.path, new Date().toISOString())
  db.run(
    `DELETE FROM panel_access_logs
     WHERE id NOT IN (SELECT id FROM panel_access_logs ORDER BY id DESC LIMIT 1000)`
  )
}

export function listPanelAccessLogs(limit = 200): PanelAccessLog[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 1_000)
  return db
    .query<PanelAccessLogRow, [number]>(
      "SELECT id, ip, event, status, path, created_at FROM panel_access_logs ORDER BY id DESC LIMIT ?"
    )
    .all(safeLimit)
    .map((row) => ({
      id: row.id,
      ip: row.ip,
      event: row.event,
      status: row.status,
      path: row.path,
      createdAt: row.created_at,
    }))
}
