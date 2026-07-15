const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64(value: Uint8Array) {
  return Buffer.from(value).toString("base64")
}

function fromBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"))
}

export function isEncryptionReady() {
  return Boolean(process.env.DASHBOARD_ENCRYPTION_KEY)
}

async function getKey() {
  const secret = process.env.DASHBOARD_ENCRYPTION_KEY
  if (!secret) {
    throw new Error("DASHBOARD_ENCRYPTION_KEY is required to save Telegram settings.")
  }

  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret))
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getKey(),
    encoder.encode(value)
  )
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`
}

export async function decryptSecret(value: string) {
  const [encodedIv, encodedCiphertext] = value.split(".")
  if (!encodedIv || !encodedCiphertext) {
    throw new Error("Stored Telegram token is invalid.")
  }

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encodedIv) },
    await getKey(),
    fromBase64(encodedCiphertext)
  )
  return decoder.decode(plaintext)
}

export function maskSecret(value: string) {
  if (value.length <= 8) return "••••••••"
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}
