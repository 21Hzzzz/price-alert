import { getLatestPrices } from "~/lib/binance.server"
import {
  getEncryptedFwAlertSettings,
  getEncryptedTelegramSettings,
  listRules,
  updateRuleMarketState,
} from "~/lib/db.server"
import { decryptSecret } from "~/lib/crypto.server"
import { triggerFwAlert } from "~/lib/fwalert.server"
import { didCrossTarget, getCrossedIntervalLevels, isWithinCooldown } from "~/lib/monitoring"
import type { MarketSnapshot } from "~/lib/price-alert.types"
import { sendTelegramMessage } from "~/lib/telegram.server"

let monitorError: string | null = null
let interval: ReturnType<typeof setInterval> | null = null
let isRunning = false

export async function runMonitoringCycle() {
  if (isRunning) return
  isRunning = true
  try {
    const rules = listRules().filter((rule) => rule.enabled)
    const prices = await getLatestPrices([...new Set(rules.map((rule) => rule.symbol))])
    const telegram = getEncryptedTelegramSettings()
    const fwalert = getEncryptedFwAlertSettings()

    for (const rule of rules) {
      const currentPrice = prices.get(rule.symbol)
      if (!currentPrice) continue

      const crossedLevels = rule.triggerType === "interval"
        ? getCrossedIntervalLevels({
          previousPrice: rule.lastPrice,
          currentPrice,
          interval: rule.interval ?? rule.targetPrice,
        })
        : didCrossTarget({
          direction: rule.direction,
          previousPrice: rule.lastPrice,
          currentPrice,
          targetPrice: rule.targetPrice,
        }) ? [rule.targetPrice] : []

      if (crossedLevels.length === 0) {
        updateRuleMarketState(rule.id, { lastPrice: currentPrice, lastError: null })
        continue
      }

      const attempts: Array<{ channel: "telegram" | "phone"; promise: Promise<void> }> = []
      if (rule.channels.includes("telegram")) {
        attempts.push({ channel: "telegram", promise: (async () => {
          if (!telegram) throw new Error("Telegram 渠道尚未配置。")
          const token = await decryptSecret(telegram.encrypted_token)
          const condition = rule.triggerType === "interval"
            ? `跨越整数倍价位 ${crossedLevels.join("、")}（粒度 ${rule.interval ?? rule.targetPrice}）`
            : `${rule.direction === "above" ? "上穿" : "下穿"} ${rule.targetPrice}`
          await sendTelegramMessage({
            token,
            chatId: telegram.chat_id,
            text: `Price Alert\n${rule.symbol} ${condition}\n当前价格: ${currentPrice}`,
          })
        })() })
      }
      const phoneCooling = rule.channels.includes("phone") && isWithinCooldown(rule.lastPhoneTriggeredAt, 65_000)
      if (rule.channels.includes("phone") && !phoneCooling) {
        attempts.push({ channel: "phone", promise: (async () => {
          if (!fwalert) throw new Error("FwAlert 电话渠道尚未配置。")
          await triggerFwAlert(await decryptSecret(fwalert.encrypted_url))
        })() })
      }

      if (attempts.length === 0) {
        updateRuleMarketState(rule.id, { lastPrice: currentPrice, lastError: null })
        continue
      }

      const results = await Promise.allSettled(attempts.map((attempt) => attempt.promise))
      const errors = results.flatMap((result, index) => result.status === "rejected"
        ? [`${attempts[index].channel === "phone" ? "FwAlert 电话" : "Telegram"}：${result.reason instanceof Error ? result.reason.message : "推送失败。"}`]
        : [])
      const succeeded = results.some((result) => result.status === "fulfilled")
      const phoneSucceeded = results.some((result, index) => result.status === "fulfilled" && attempts[index].channel === "phone")
      if (succeeded) {
        updateRuleMarketState(rule.id, {
          lastPrice: currentPrice,
          lastTriggeredAt: new Date().toISOString(),
          lastPhoneTriggeredAt: phoneSucceeded ? new Date().toISOString() : null,
          lastError: errors.length > 0 ? errors.join(" ") : null,
        })
      } else {
        updateRuleMarketState(rule.id, {
          lastPrice: currentPrice,
          lastError: errors.join(" ") || "通知推送失败。",
        })
      }
    }
    monitorError = null
  } catch (error) {
    monitorError = error instanceof Error ? error.message : "Market monitor failed."
  } finally {
    isRunning = false
  }
}

export function startMonitor() {
  if (interval) return
  void runMonitoringCycle()
  interval = setInterval(() => void runMonitoringCycle(), 5_000)
}

export function getMonitorSnapshot(): MarketSnapshot {
  return {
    rules: listRules(),
    monitoredAt: new Date().toISOString(),
    monitorError,
  }
}
