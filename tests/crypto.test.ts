import { expect, test } from "bun:test"

import { decryptSecret, encryptSecret, maskSecret } from "../app/lib/crypto.server"

test("encrypts Telegram secrets without retaining plaintext", async () => {
  process.env.DASHBOARD_ENCRYPTION_KEY = "test-key-for-dashboard"
  const secret = "123456:telegram-secret-token"
  const encrypted = await encryptSecret(secret)

  expect(encrypted).not.toContain(secret)
  expect(await decryptSecret(encrypted)).toBe(secret)
  expect(maskSecret(secret)).toBe("1234••••oken")
})
