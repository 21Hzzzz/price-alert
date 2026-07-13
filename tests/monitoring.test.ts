import { expect, test } from "bun:test"

import { didCrossTarget, getCrossedIntervalLevels, isPositivePrice, isWithinCooldown } from "../app/lib/monitoring"

test("validates positive target prices", () => {
  expect(isPositivePrice("0.0001")).toBe(true)
  expect(isPositivePrice("0")).toBe(false)
  expect(isPositivePrice("abc")).toBe(false)
})

test("only detects a real upward crossing", () => {
  expect(didCrossTarget({ direction: "above", previousPrice: "99", currentPrice: "100", targetPrice: "100" })).toBe(true)
  expect(didCrossTarget({ direction: "above", previousPrice: "100", currentPrice: "101", targetPrice: "100" })).toBe(false)
  expect(didCrossTarget({ direction: "above", previousPrice: null, currentPrice: "101", targetPrice: "100" })).toBe(false)
})

test("only detects a real downward crossing", () => {
  expect(didCrossTarget({ direction: "below", previousPrice: "101", currentPrice: "100", targetPrice: "100" })).toBe(true)
  expect(didCrossTarget({ direction: "below", previousPrice: "100", currentPrice: "99", targetPrice: "100" })).toBe(false)
})

test("detects every crossed integer-multiple level", () => {
  expect(getCrossedIntervalLevels({ previousPrice: "71950", currentPrice: "73100", interval: "1000" })).toEqual(["72000", "73000"])
  expect(getCrossedIntervalLevels({ previousPrice: "73100", currentPrice: "71950", interval: "1000" })).toEqual(["73000", "72000"])
  expect(getCrossedIntervalLevels({ previousPrice: "72000", currentPrice: "72100", interval: "1000" })).toEqual([])
})

test("applies a local phone cooldown for sixty-five seconds", () => {
  expect(isWithinCooldown("2026-01-01T00:00:00.000Z", 65_000, Date.parse("2026-01-01T00:01:04.999Z"))).toBe(true)
  expect(isWithinCooldown("2026-01-01T00:00:00.000Z", 65_000, Date.parse("2026-01-01T00:01:05.000Z"))).toBe(false)
})
