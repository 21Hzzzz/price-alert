import { expect, test } from "bun:test"

import { encodeFunctionCalldata, isHexCalldata, parseNativeValue } from "../app/lib/contract-calldata"

test("encodes function signature and JSON parameters into calldata", () => {
  expect(encodeFunctionCalldata(
    "transfer(address,uint256)",
    '["0x000000000000000000000000000000000000dEaD", "1000000"]',
  )).toBe("0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead00000000000000000000000000000000000000000000000000000000000f4240")
})

test("validates raw calldata and payable value", () => {
  expect(isHexCalldata("0xa9059cbb")).toBe(true)
  expect(isHexCalldata("0xa9059cb")).toBe(false)
  expect(parseNativeValue("1.25")).toBe(1_250_000_000_000_000_000n)
  expect(() => parseNativeValue("0.0000000000000000001")).toThrow()
})
