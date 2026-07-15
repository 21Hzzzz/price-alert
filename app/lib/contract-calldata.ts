import { encodeFunctionData, parseAbi, parseUnits, type Abi } from "viem"

const parseRuntimeAbi = parseAbi as unknown as (signatures: readonly string[]) => Abi
const encodeRuntimeFunctionData = encodeFunctionData as unknown as (parameters: {
  abi: Abi
  functionName: string
  args: readonly unknown[]
}) => `0x${string}`

export function isHexCalldata(value: string) {
  return /^0x(?:[\da-f]{2})*$/i.test(value.trim())
}

export function parseNativeValue(value: string) {
  const normalized = value.trim()
  if (!normalized) return 0n
  if (!/^\d+(?:\.\d{1,18})?$/.test(normalized)) {
    throw new Error("原生币金额最多支持 18 位小数。")
  }
  return parseUnits(normalized, 18)
}

export function encodeFunctionCalldata(functionSignature: string, argumentsJson: string) {
  const signature = functionSignature.trim().replace(/^function\s+/i, "")
  const functionName = signature.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1]
  if (!functionName) {
    throw new Error("请输入函数签名，例如 transfer(address,uint256)。")
  }

  let args: unknown
  try {
    args = JSON.parse(argumentsJson || "[]")
  } catch {
    throw new Error("参数必须是合法的 JSON 数组。")
  }
  if (!Array.isArray(args)) throw new Error("参数必须是 JSON 数组。")

  try {
    return encodeRuntimeFunctionData({
      abi: parseRuntimeAbi([`function ${signature}`]),
      functionName,
      args,
    })
  } catch (error) {
    throw new Error(error instanceof Error ? `无法编码函数参数：${error.message}` : "无法编码函数参数。")
  }
}
