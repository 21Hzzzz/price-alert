import { expect, test } from "bun:test"

import { extractEvmAddressFromQr } from "../app/lib/wallet-address"

test("extracts EVM addresses from direct and ethereum URI QR payloads", () => {
  const address = "0x000000000000000000000000000000000000dEaD"
  expect(extractEvmAddressFromQr(address)).toBe(address)
  expect(extractEvmAddressFromQr(`ethereum:${address}@1?value=100`)).toBe(address)
  expect(extractEvmAddressFromQr("https://example.com")).toBeNull()
})
