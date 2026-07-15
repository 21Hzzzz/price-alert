import { decryptSecret, encryptSecret, isEncryptionReady } from "~/lib/crypto.server"
import {
  getEncryptedFwAlertSettings,
  getFwAlertSettingsStatusWithSecret,
  saveFwAlertSettings,
} from "~/lib/db.server"
import { validateFwAlertUrl } from "~/lib/fwalert.server"

export async function saveFwAlertConfiguration(url: string) {
  if (!isEncryptionReady()) {
    throw new Error("缺少 DASHBOARD_ENCRYPTION_KEY，无法安全保存电话链接。")
  }
  const validatedUrl = validateFwAlertUrl(url)
  saveFwAlertSettings(await encryptSecret(validatedUrl))
  return getFwAlertSettingsStatusWithSecret()
}

export async function getFwAlertUrl() {
  const settings = getEncryptedFwAlertSettings()
  if (!settings) throw new Error("请先保存 FwAlert 电话链接。")
  return decryptSecret(settings.encrypted_url)
}
