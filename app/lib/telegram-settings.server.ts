import { decryptSecret, encryptSecret, isEncryptionReady } from "~/lib/crypto.server"
import {
  getEncryptedTelegramSettings,
  getTelegramSettingsStatusWithSecret,
  saveTelegramSettings,
} from "~/lib/db.server"

export async function saveTelegramConfiguration(token: string, chatId: string) {
  if (!isEncryptionReady()) {
    throw new Error("缺少 DASHBOARD_ENCRYPTION_KEY，无法安全保存 Token。")
  }
  saveTelegramSettings(await encryptSecret(token), chatId)
  return getTelegramSettingsStatusWithSecret()
}

export async function getTelegramCredentials() {
  const settings = getEncryptedTelegramSettings()
  if (!settings) throw new Error("请先保存 Telegram 配置。")
  return { token: await decryptSecret(settings.encrypted_token), chatId: settings.chat_id }
}
