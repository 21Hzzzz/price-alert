import type { AlertDirection } from "~/lib/price-alert.types"

export function isPositivePrice(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
}

export function didCrossTarget({
  direction,
  previousPrice,
  currentPrice,
  targetPrice,
}: {
  direction: AlertDirection
  previousPrice: string | null
  currentPrice: string
  targetPrice: string
}) {
  if (previousPrice === null) return false

  const previous = Number(previousPrice)
  const current = Number(currentPrice)
  const target = Number(targetPrice)
  if (![previous, current, target].every(Number.isFinite)) return false

  return direction === "above"
    ? previous < target && current >= target
    : previous > target && current <= target
}

export function getCrossedIntervalLevels({
  previousPrice,
  currentPrice,
  interval,
}: {
  previousPrice: string | null
  currentPrice: string
  interval: string
}) {
  if (previousPrice === null) return []

  const previous = Number(previousPrice)
  const current = Number(currentPrice)
  const step = Number(interval)
  if (![previous, current, step].every(Number.isFinite) || step <= 0 || previous === current) return []

  const first = previous < current
    ? Math.floor(previous / step) + 1
    : Math.ceil(previous / step) - 1
  const last = previous < current
    ? Math.floor(current / step)
    : Math.ceil(current / step)
  const count = previous < current ? last - first + 1 : first - last + 1
  if (count <= 0) return []

  const maxLevels = 50
  const indices = Array.from({ length: Math.min(count, maxLevels) }, (_, index) => previous < current ? first + index : first - index)
  return indices.map((index) => String(Number((index * step).toPrecision(15))))
}

export function isWithinCooldown(lastTriggeredAt: string | null, cooldownMs: number, now = Date.now()) {
  if (!lastTriggeredAt) return false
  const timestamp = Date.parse(lastTriggeredAt)
  return Number.isFinite(timestamp) && now - timestamp < cooldownMs
}
