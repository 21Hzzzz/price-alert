import { getLatestPrices as getBinanceLatestPrices } from "~/lib/binance.server"
import {
  getEncryptedFwAlertSettings,
  getEncryptedTelegramSettings,
  listRules,
  updateRuleMarketState,
} from "~/lib/db.server"
import { decryptSecret } from "~/lib/crypto.server"
import { triggerFwAlert } from "~/lib/fwalert.server"
import { didCrossTarget, getCrossedIntervalLevels, getDeviationPercent, isWithinCooldown, retainIntervalSuppressions } from "~/lib/monitoring"
import { getLatestPrices as getOkxLatestPrices } from "~/lib/okx.server"
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
    const binanceSymbols = new Set<string>()
    const okxSymbols = new Set<string>()
    for (const rule of rules) {
      ;(rule.market === "okx" ? okxSymbols : binanceSymbols).add(rule.symbol)
      if (rule.triggerType === "basket") {
        for (const member of rule.basketMembers) {
          ;(member.market === "okx" ? okxSymbols : binanceSymbols).add(member.symbol)
        }
      }
    }
    const [binancePrices, okxPrices] = await Promise.all([
      getBinanceLatestPrices([...binanceSymbols]),
      getOkxLatestPrices([...okxSymbols]),
    ])
    const telegram = getEncryptedTelegramSettings()
    const fwalert = getEncryptedFwAlertSettings()

    for (const rule of rules) {
      const currentPrice = (rule.market === "okx" ? okxPrices : binancePrices).get(rule.symbol)
      if (!currentPrice) continue

      const basketMembers = rule.triggerType === "basket" ? rule.basketMembers : []
      const basketMemberKeys = new Set(basketMembers.map((member) => `${member.market}:${member.symbol}`))
      const observedBasketMemberKeys = new Set<string>()
      const currentBasketBreaches = basketMembers.flatMap((member) => {
        const memberPrice = (member.market === "okx" ? okxPrices : binancePrices).get(member.symbol)
        if (!memberPrice) return []
        const key = `${member.market}:${member.symbol}`
        observedBasketMemberKeys.add(key)
        const deviation = getDeviationPercent(currentPrice, memberPrice)
        return deviation !== null && Math.abs(deviation) >= Number(rule.deviationPercent)
          ? [{ ...member, key, price: memberPrice, deviation }]
          : []
      })
      const basketBreaches = rule.triggerType === "basket"
        ? [
          ...rule.basketBreaches.filter((key) => basketMemberKeys.has(key) && !observedBasketMemberKeys.has(key)),
          ...currentBasketBreaches.map((member) => member.key),
        ]
        : undefined
      const newBasketBreaches = currentBasketBreaches.filter((member) => !rule.basketBreaches.includes(member.key))

      const intervalSuppressions = rule.triggerType === "interval"
        ? retainIntervalSuppressions({
          currentPrice,
          levels: rule.intervalSuppressions,
          resetRange: rule.intervalResetRange,
        })
        : undefined
      const crossedLevels = rule.triggerType === "interval"
        ? getCrossedIntervalLevels({
          previousPrice: rule.lastPrice,
          currentPrice,
          interval: rule.interval ?? rule.targetPrice,
        })
        : rule.triggerType === "target" && didCrossTarget({
          direction: rule.direction,
          previousPrice: rule.lastPrice,
          currentPrice,
          targetPrice: rule.targetPrice,
        }) ? [rule.targetPrice] : []
      const alertLevels = rule.triggerType === "interval"
        ? crossedLevels.filter((level) => !intervalSuppressions?.includes(level))
        : crossedLevels

      if ((rule.triggerType === "basket" ? newBasketBreaches.length : alertLevels.length) === 0) {
        updateRuleMarketState(rule.id, { lastPrice: currentPrice, lastError: null, intervalSuppressions, basketBreaches })
        continue
      }

      const attempts: Array<{ channel: "telegram" | "phone"; promise: Promise<void> }> = []
      if (rule.channels.includes("telegram")) {
        attempts.push({ channel: "telegram", promise: (async () => {
          if (!telegram) throw new Error("Telegram 渠道尚未配置。")
          const token = await decryptSecret(telegram.encrypted_token)
          const condition = rule.triggerType === "basket"
            ? `篮子偏离 ≥ ${rule.deviationPercent}%\n锚点: ${rule.market === "okx" ? "OKX 现货" : "Binance 现货"} · ${rule.symbol} (${currentPrice})\n偏离交易对:\n${newBasketBreaches.map((member) => `${member.market === "okx" ? "OKX 现货" : "Binance 现货"} · ${member.symbol}: ${member.price} (${member.deviation >= 0 ? "+" : ""}${member.deviation.toFixed(3)}%)`).join("\n")}`
            : rule.triggerType === "interval"
            ? `${Number(currentPrice) > Number(rule.lastPrice) ? "上穿" : "下穿"}整数倍价位 ${alertLevels.join("、")}（粒度 ${rule.interval ?? rule.targetPrice}，重置范围 ±${rule.intervalResetRange}）`
            : `${rule.direction === "above" ? "上穿" : "下穿"} ${rule.targetPrice}`
          await sendTelegramMessage({
            token,
            chatId: telegram.chat_id,
            text: `Dashboard\n${rule.market === "okx" ? "OKX 现货" : "Binance 现货"} · ${rule.symbol} ${condition}\n当前价格: ${currentPrice}`,
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
        updateRuleMarketState(rule.id, { lastPrice: currentPrice, lastError: null, intervalSuppressions })
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
          intervalSuppressions: rule.triggerType === "interval"
            ? [...new Set([...(intervalSuppressions ?? []), ...alertLevels])]
            : undefined,
          basketBreaches,
        })
      } else {
        updateRuleMarketState(rule.id, {
          lastPrice: currentPrice,
          lastError: errors.join(" ") || "通知推送失败。",
          intervalSuppressions,
          basketBreaches: rule.triggerType === "basket" ? rule.basketBreaches : undefined,
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
