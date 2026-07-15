export const WEI_PER_NATIVE = 10n ** 18n
export const STRICT_NATIVE_SWEEP_CHAIN_IDS = [1, 56, 137] as const

export function supportsStrictNativeSweep(chainId: number) {
  return (STRICT_NATIVE_SWEEP_CHAIN_IDS as readonly number[]).includes(chainId)
}

export type SweepAmounts = {
  gasFeeWei: bigint
  transferableWei: bigint
  remainingWei: bigint
  canSweep: boolean
}

export function calculateSweepAmounts(
  balanceWei: bigint,
  gasPriceWei: bigint,
  gasLimit: bigint,
): SweepAmounts {
  const gasFeeWei = gasPriceWei * gasLimit
  const canSweep = balanceWei > 0n && balanceWei >= gasFeeWei
  const transferableWei = canSweep ? balanceWei - gasFeeWei : 0n
  const remainingWei = canSweep ? balanceWei - gasFeeWei - transferableWei : balanceWei

  return { gasFeeWei, transferableWei, remainingWei, canSweep }
}

export function isEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export function toRpcQuantity(value: bigint) {
  return `0x${value.toString(16)}`
}

export function formatNativeAmount(value: bigint, maximumFractionDigits = 6) {
  const whole = value / WEI_PER_NATIVE
  const fraction = (value % WEI_PER_NATIVE)
    .toString()
    .padStart(18, "0")
    .slice(0, maximumFractionDigits)
    .replace(/0+$/, "")

  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function formatExactNativeAmount(value: bigint) {
  const whole = value / WEI_PER_NATIVE
  const fraction = (value % WEI_PER_NATIVE).toString().padStart(18, "0")
  return `${whole}.${fraction}`
}
