import { getSpotSymbols as getBinanceSpotSymbols } from "~/lib/binance.server"
import { isEncryptionReady } from "~/lib/crypto.server"
import {
  createRule,
  deleteRule,
  getRule,
  getFwAlertSettingsStatusWithSecret,
  getTelegramSettingsStatusWithSecret,
  listPanelAccessLogs,
  listRules,
  updateRule,
} from "~/lib/db.server"
import { isPositivePrice } from "~/lib/monitoring"
import { getMonitorSnapshot } from "~/lib/monitor.service.server"
import { getSpotSymbols as getOkxSpotSymbols } from "~/lib/okx.server"
import type { AlertDirection, AlertRuleConfig, AlertTriggerType, BasketMember, NotificationChannel, RuleExportFile, SpotMarket, SpotSymbol } from "~/lib/price-alert.types"
import { triggerFwAlert } from "~/lib/fwalert.server"
import { getFwAlertUrl, saveFwAlertConfiguration } from "~/lib/fwalert-settings.server"
import {
  getTelegramCredentials,
  saveTelegramConfiguration,
} from "~/lib/telegram-settings.server"
import { sendTelegramMessage } from "~/lib/telegram.server"

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

function isDirection(value: unknown): value is AlertDirection {
  return value === "above" || value === "below"
}

function isTriggerType(value: unknown): value is AlertTriggerType {
  return value === "target" || value === "interval" || value === "basket"
}

function isSpotMarket(value: unknown): value is SpotMarket {
  return value === "binance" || value === "okx"
}

function isNonNegativePrice(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0
}

function isChannels(value: unknown): value is NotificationChannel[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((channel) => channel === "telegram" || channel === "phone")
}

async function getSpotSymbols(market: SpotMarket): Promise<SpotSymbol[]> {
  return market === "okx" ? getOkxSpotSymbols() : getBinanceSpotSymbols()
}

async function validateSpotSymbol(market: SpotMarket, symbol: string) {
  const pairs = await getSpotSymbols(market)
  return pairs.some((pair) => pair.symbol === symbol)
}

function normalizeBasketMembers(value: unknown): BasketMember[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const members: BasketMember[] = []
  const keys = new Set<string>()
  for (const member of value) {
    if (!member || typeof member !== "object") return null
    const { market, symbol } = member as { market?: unknown; symbol?: unknown }
    if (!isSpotMarket(market) || typeof symbol !== "string" || !symbol.trim()) return null
    const normalized = { market, symbol: symbol.trim().toUpperCase() }
    const key = `${normalized.market}:${normalized.symbol}`
    if (keys.has(key)) return null
    keys.add(key)
    members.push(normalized)
  }
  return members
}

async function validateBasketMembers(members: BasketMember[], anchor: BasketMember) {
  if (members.some((member) => member.market === anchor.market && member.symbol === anchor.symbol)) return false
  const valid = await Promise.all(members.map((member) => validateSpotSymbol(member.market, member.symbol)))
  return valid.every(Boolean)
}

function normalizeRuleConfig(value: unknown): AlertRuleConfig | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Partial<AlertRuleConfig>
  const market = raw.market
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : ""
  const triggerType = raw.triggerType
  const direction = raw.direction
  const targetPrice = typeof raw.targetPrice === "string" ? raw.targetPrice.trim() : ""
  const interval = typeof raw.interval === "string" ? raw.interval.trim() : raw.interval === null ? null : undefined
  const intervalResetRange = typeof raw.intervalResetRange === "string" ? raw.intervalResetRange.trim() : ""
  const basketMembers = triggerType === "basket" ? normalizeBasketMembers(raw.basketMembers) : []
  const deviationPercent = typeof raw.deviationPercent === "string" ? raw.deviationPercent.trim() : null
  if (!isSpotMarket(market) || !symbol || !isTriggerType(triggerType) || !isDirection(direction) || !isChannels(raw.channels) || interval === undefined) return null
  if (triggerType === "target" && !isPositivePrice(targetPrice)) return null
  if (triggerType === "interval" && (!interval || !isPositivePrice(interval) || !isNonNegativePrice(intervalResetRange))) return null
  if (triggerType === "basket" && (!basketMembers || !deviationPercent || !isPositivePrice(deviationPercent))) return null
  if (typeof raw.enabled !== "boolean") return null
  return {
    market,
    symbol,
    triggerType,
    direction,
    targetPrice: triggerType === "target" ? targetPrice : triggerType === "interval" ? interval! : "0",
    interval: triggerType === "interval" ? interval! : null,
    intervalResetRange: triggerType === "interval" ? intervalResetRange : "0",
    basketMembers: basketMembers ?? [],
    deviationPercent: triggerType === "basket" ? deviationPercent! : null,
    channels: raw.channels,
    enabled: raw.enabled,
  }
}

async function validateImportedRules(rules: AlertRuleConfig[]) {
  const [binanceSymbols, okxSymbols] = await Promise.all([getBinanceSpotSymbols(), getOkxSpotSymbols()])
  const available = {
    binance: new Set(binanceSymbols.map((pair) => pair.symbol)),
    okx: new Set(okxSymbols.map((pair) => pair.symbol)),
  }
  return rules.every((rule) => available[rule.market].has(rule.symbol)
    && (rule.triggerType !== "basket" || rule.basketMembers.every((member) => available[member.market].has(member.symbol)
      && !(member.market === rule.market && member.symbol === rule.symbol))))
}

export async function handleApiRequest(request: Request, pathname: string) {
  try {
    if (pathname === "/api/dashboard" && request.method === "GET") {
      const [binanceSymbols, okxSymbols, telegram, fwalert] = await Promise.all([
        getBinanceSpotSymbols(),
        getOkxSpotSymbols(),
        getTelegramSettingsStatusWithSecret(),
        getFwAlertSettingsStatusWithSecret(),
      ])
      return Response.json({ symbols: { binance: binanceSymbols, okx: okxSymbols }, rules: listRules(), telegram, fwalert })
    }
    if (pathname === "/api/market/snapshot" && request.method === "GET") {
      return Response.json(getMonitorSnapshot())
    }
    if (pathname === "/api/access-logs" && request.method === "GET") {
      return Response.json({ logs: listPanelAccessLogs() })
    }
    if (pathname === "/api/telegram-settings" && request.method === "GET") {
      return Response.json({ telegram: await getTelegramSettingsStatusWithSecret() })
    }
    if (pathname === "/api/telegram-settings" && request.method === "POST") {
      const body = (await request.json()) as { token?: string; chatId?: string }
      const token = body.token?.trim()
      const chatId = body.chatId?.trim()
      if (!token || !chatId) return error("Bot Token 和 Chat ID 均为必填项。")
      if (!isEncryptionReady()) return error("缺少 DASHBOARD_ENCRYPTION_KEY，无法安全保存 Token。", 503)
      return Response.json({ telegram: await saveTelegramConfiguration(token, chatId) })
    }
    if (pathname === "/api/telegram-settings/test" && request.method === "POST") {
      const settings = await getTelegramCredentials()
      await sendTelegramMessage({
        ...settings,
        text: "Dashboard 已连接。此消息用于验证 Telegram 推送配置。",
      })
      return Response.json({ ok: true })
    }
    if (pathname === "/api/fwalert-settings" && request.method === "GET") {
      return Response.json({ fwalert: await getFwAlertSettingsStatusWithSecret() })
    }
    if (pathname === "/api/fwalert-settings" && request.method === "POST") {
      const body = (await request.json()) as { url?: string }
      const url = body.url?.trim()
      if (!url) return error("FwAlert 电话链接为必填项。")
      return Response.json({ fwalert: await saveFwAlertConfiguration(url) })
    }
    if (pathname === "/api/fwalert-settings/test" && request.method === "POST") {
      await triggerFwAlert(await getFwAlertUrl())
      return Response.json({ ok: true })
    }
    if (pathname === "/api/alert-rules" && request.method === "GET") {
      return Response.json({ rules: listRules() })
    }
    if (pathname === "/api/alert-rules/import" && request.method === "POST") {
      const body = (await request.json()) as Partial<RuleExportFile>
      if (body.version !== 1 || !Array.isArray(body.rules) || body.rules.length === 0 || body.rules.length > 500) {
        return error("导入文件无效；规则数量必须在 1 到 500 条之间。")
      }
      const rules = body.rules.map(normalizeRuleConfig)
      if (rules.some((rule) => !rule)) return error("导入文件中存在无效规则。")
      const validRules = rules as AlertRuleConfig[]
      if (!await validateImportedRules(validRules)) return error("导入文件包含当前不可交易、无效或与锚点重复的交易对。")
      const created = validRules.map((rule) => createRule(rule))
      return Response.json({ rules: created })
    }
    if (pathname === "/api/alert-rules" && request.method === "POST") {
      const body = (await request.json()) as { market?: SpotMarket; symbol?: string; triggerType?: AlertTriggerType; direction?: AlertDirection; targetPrice?: string; interval?: string; intervalResetRange?: string; basketMembers?: BasketMember[]; deviationPercent?: string; channels?: NotificationChannel[] }
      const market = body.market ?? "binance"
      const symbol = body.symbol?.trim().toUpperCase()
      const triggerType = body.triggerType ?? "target"
      const targetPrice = body.targetPrice?.trim()
      const interval = body.interval?.trim()
      const intervalResetRange = body.intervalResetRange?.trim()
      const basketMembers = normalizeBasketMembers(body.basketMembers)
      const deviationPercent = body.deviationPercent?.trim()
      if (!isSpotMarket(market) || !symbol || !isTriggerType(triggerType) || !isChannels(body.channels)
        || (triggerType === "target" && (!isDirection(body.direction) || !targetPrice || !isPositivePrice(targetPrice)))
        || (triggerType === "interval" && (!interval || !isPositivePrice(interval) || !intervalResetRange || !isNonNegativePrice(intervalResetRange)))
        || (triggerType === "basket" && (!basketMembers || !deviationPercent || !isPositivePrice(deviationPercent)))) {
        return error("请填写有效的交易对、触发条件、正数目标价或粒度、非负重置范围，并至少选择一个通知渠道。")
      }
      if (!await validateSpotSymbol(market, symbol)) return error("交易对不是所选市场中可交易的现货标的。")
      if (triggerType === "basket" && !await validateBasketMembers(basketMembers!, { market, symbol })) return error("篮子中包含无效、重复或与锚点相同的交易对。")
      return Response.json({ rule: createRule({
        market,
        symbol,
        triggerType,
        direction: triggerType === "target" ? body.direction! : "above",
        targetPrice: triggerType === "target" ? targetPrice! : triggerType === "interval" ? interval! : "0",
        interval: triggerType === "interval" ? interval! : null,
        intervalResetRange: triggerType === "interval" ? intervalResetRange! : "0",
        basketMembers: triggerType === "basket" ? basketMembers! : [],
        deviationPercent: triggerType === "basket" ? deviationPercent! : null,
        channels: body.channels,
      }) })
    }

    const match = pathname.match(/^\/api\/alert-rules\/(\d+)$/)
    if (match) {
      const id = Number(match[1])
      if (request.method === "DELETE") {
        return deleteRule(id) ? Response.json({ ok: true }) : error("规则不存在。", 404)
      }
      if (request.method === "PATCH") {
        const body = (await request.json()) as { market?: SpotMarket; symbol?: string; triggerType?: AlertTriggerType; direction?: AlertDirection; targetPrice?: string; interval?: string; intervalResetRange?: string; basketMembers?: BasketMember[]; deviationPercent?: string; enabled?: boolean; channels?: NotificationChannel[] }
        const existing = getRule(id)
        if (!existing) return error("规则不存在。", 404)
        const market = body.market ?? existing.market
        const symbol = body.symbol?.trim().toUpperCase() ?? existing.symbol
        const triggerType = body.triggerType ?? existing.triggerType
        const direction = body.direction ?? existing.direction
        const targetPrice = body.targetPrice?.trim() ?? existing.targetPrice
        const interval = body.interval?.trim() ?? existing.interval
        const intervalResetRange = body.intervalResetRange?.trim() ?? existing.intervalResetRange
        const basketMembers = body.basketMembers === undefined ? existing.basketMembers : normalizeBasketMembers(body.basketMembers)
        const deviationPercent = body.deviationPercent?.trim() ?? existing.deviationPercent
        if (!isSpotMarket(market) || !isTriggerType(triggerType)) return error("无效的市场或触发条件。")
        if (triggerType === "target" && (!isDirection(direction) || !isPositivePrice(targetPrice))) return error("请填写有效的方向和正数目标价。")
        if (triggerType === "interval" && (!interval || !isPositivePrice(interval) || !isNonNegativePrice(intervalResetRange))) return error("粒度必须是正数，重置范围必须是非负数。")
        if (triggerType === "basket" && (!basketMembers || basketMembers.length === 0 || !deviationPercent || !isPositivePrice(deviationPercent))) return error("篮子必须至少包含一个交易对，偏移量必须是正数。")
        if (body.channels !== undefined && !isChannels(body.channels)) return error("请至少选择一个通知渠道。")
        if (body.symbol !== undefined || body.market !== undefined) {
          if (!await validateSpotSymbol(market, symbol)) return error("交易对不是所选市场中可交易的现货标的。")
        }
        if (triggerType === "basket" && !await validateBasketMembers(basketMembers!, { market, symbol })) return error("篮子中包含无效、重复或与锚点相同的交易对。")
        const rule = updateRule(id, {
          ...body,
          market,
          symbol,
          triggerType,
          direction: triggerType === "target" ? direction : "above",
          targetPrice: triggerType === "target" ? targetPrice : triggerType === "interval" ? interval! : "0",
          interval: triggerType === "interval" ? interval : null,
          intervalResetRange: triggerType === "interval" ? intervalResetRange : "0",
          basketMembers: triggerType === "basket" ? basketMembers! : [],
          deviationPercent: triggerType === "basket" ? deviationPercent! : null,
        })
        return Response.json({ rule: rule! })
      }
    }
    return error("Not found.", 404)
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "服务请求失败。", 500)
  }
}
