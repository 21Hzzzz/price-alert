export function extractEvmAddressFromQr(value: string) {
  return value.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null
}
