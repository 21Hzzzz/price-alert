import * as React from "react"
import { Braces, Check, CircleAlert, Code2, ExternalLink, LoaderCircle, LogOut, Send, WalletCards } from "lucide-react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { encodeFunctionCalldata, isHexCalldata, parseNativeValue } from "~/lib/contract-calldata"
import {
  calculateSweepAmounts,
  formatExactNativeAmount,
  isEvmAddress,
  supportsStrictNativeSweep,
  toRpcQuantity,
  type SweepAmounts,
} from "~/lib/wallet-sweep"

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: "accountsChanged" | "chainChanged", handler: (value: unknown) => void) => void
  removeListener?: (event: "accountsChanged" | "chainChanged", handler: (value: unknown) => void) => void
}

type EvmNetwork = {
  chainId: number
  name: string
  symbol: string
}

type SweepPlan = SweepAmounts & {
  balanceWei: bigint
  gasPriceWei: bigint
  gasLimit: bigint
  network: EvmNetwork
}

const NETWORKS: EvmNetwork[] = [
  { chainId: 1, name: "Ethereum", symbol: "ETH" },
  { chainId: 56, name: "BNB Smart Chain", symbol: "BNB" },
  { chainId: 137, name: "Polygon", symbol: "POL" },
  { chainId: 10, name: "Optimism", symbol: "ETH" },
  { chainId: 42161, name: "Arbitrum One", symbol: "ETH" },
  { chainId: 8453, name: "Base", symbol: "ETH" },
]

const STRICT_NATIVE_TRANSFER_GAS = 21_000n

function getProvider() {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { ethereum?: Eip1193Provider }).ethereum
}

function asRpcQuantity(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[\da-f]+$/i.test(value)) {
    throw new Error(`${label} 返回了无效数据，请稍后重试。`)
  }
  return BigInt(value)
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function toChainId(value: unknown) {
  if (typeof value !== "string" || !/^0x[\da-f]+$/i.test(value)) return null
  return Number.parseInt(value, 16)
}

function providerError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return fallback
}

type ContractInteractionPlan = {
  contractAddress: string
  calldata: string
  valueWei: bigint
  gasLimit: bigint
  gasPriceWei: bigint
  network: EvmNetwork
}

function isEoaCode(value: unknown) {
  return typeof value === "string" && /^0x0*$/i.test(value)
}

async function createStrictSweepPlan(
  provider: Eip1193Provider,
  account: string,
  destination: string,
  network: EvmNetwork,
) {
  if (!supportsStrictNativeSweep(network.chainId)) {
    throw new Error(`${network.name} 的费用包含额外网络成本，暂不支持严格归零。`)
  }
  const [balanceValue, gasPriceValue, destinationCode, latestNonceValue, pendingNonceValue] = await Promise.all([
    provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    provider.request({ method: "eth_gasPrice" }),
    provider.request({ method: "eth_getCode", params: [destination, "latest"] }),
    provider.request({ method: "eth_getTransactionCount", params: [account, "latest"] }),
    provider.request({ method: "eth_getTransactionCount", params: [account, "pending"] }),
  ])
  if (!isEoaCode(destinationCode)) throw new Error("严格归零仅支持普通 EOA 收款地址，不支持合约地址。")

  const balanceWei = asRpcQuantity(balanceValue, "余额")
  const gasPriceWei = asRpcQuantity(gasPriceValue, "Gas 价格")
  const latestNonce = asRpcQuantity(latestNonceValue, "交易 nonce")
  const pendingNonce = asRpcQuantity(pendingNonceValue, "待确认交易 nonce")
  if (latestNonce !== pendingNonce) throw new Error("当前地址存在待确认交易。请等待交易完成后再执行严格归零。")

  const amounts = calculateSweepAmounts(balanceWei, gasPriceWei, STRICT_NATIVE_TRANSFER_GAS)
  if (!amounts.canSweep) throw new Error("当前余额不足以支付固定 21,000 Gas 的手续费。")

  const estimatedGas = asRpcQuantity(
    await provider.request({
      method: "eth_estimateGas",
      params: [{ from: account, to: destination, value: "0x0", gasPrice: toRpcQuantity(gasPriceWei) }],
    }),
    "Gas 估算",
  )
  if (estimatedGas !== STRICT_NATIVE_TRANSFER_GAS) throw new Error("当前网络未返回标准的 21,000 Gas 原生转账估算，无法保证严格归零。")

  return { ...amounts, balanceWei, gasPriceWei, gasLimit: STRICT_NATIVE_TRANSFER_GAS, network } satisfies SweepPlan
}

async function createContractInteractionPlan(
  provider: Eip1193Provider,
  account: string,
  contractAddress: string,
  calldata: string,
  valueWei: bigint,
  network: EvmNetwork,
) {
  const transaction = {
    from: account,
    to: contractAddress,
    data: calldata,
    value: toRpcQuantity(valueWei),
  }
  const [gasLimitValue, gasPriceValue] = await Promise.all([
    provider.request({ method: "eth_estimateGas", params: [transaction] }),
    provider.request({ method: "eth_gasPrice" }),
  ])

  return {
    contractAddress,
    calldata,
    valueWei,
    gasLimit: asRpcQuantity(gasLimitValue, "Gas 估算"),
    gasPriceWei: asRpcQuantity(gasPriceValue, "Gas 价格"),
    network,
  } satisfies ContractInteractionPlan
}

export function WalletClient() {
  const [account, setAccount] = React.useState<string | null>(null)
  const [connectedChainId, setConnectedChainId] = React.useState<number | null>(null)
  const [selectedChainId, setSelectedChainId] = React.useState("1")
  const [destination, setDestination] = React.useState("")
  const [plan, setPlan] = React.useState<SweepPlan | null>(null)
  const [connecting, setConnecting] = React.useState(false)
  const [calculating, setCalculating] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [transactionHash, setTransactionHash] = React.useState<string | null>(null)
  const [nativeBalanceWei, setNativeBalanceWei] = React.useState<bigint | null>(null)
  const [balanceLoading, setBalanceLoading] = React.useState(false)
  const [contractAddress, setContractAddress] = React.useState("")
  const [contractCalldata, setContractCalldata] = React.useState("")
  const [functionSignature, setFunctionSignature] = React.useState("")
  const [functionArguments, setFunctionArguments] = React.useState("[]")
  const [contractValue, setContractValue] = React.useState("")
  const [contractPlan, setContractPlan] = React.useState<ContractInteractionPlan | null>(null)
  const [contractCalculating, setContractCalculating] = React.useState(false)
  const [contractSubmitting, setContractSubmitting] = React.useState(false)
  const [contractConfirmOpen, setContractConfirmOpen] = React.useState(false)
  const [contractTransactionHash, setContractTransactionHash] = React.useState<string | null>(null)

  const selectedNetwork = NETWORKS.find((network) => network.chainId === Number(selectedChainId)) ?? NETWORKS[0]
  const connectedNetwork = NETWORKS.find((network) => network.chainId === connectedChainId)
  const onSelectedNetwork = connectedChainId === selectedNetwork.chainId
  const strictSweepSupported = supportsStrictNativeSweep(selectedNetwork.chainId)

  React.useEffect(() => {
    const provider = getProvider()
    if (!provider || !account || !onSelectedNetwork) {
      setNativeBalanceWei(null)
      setBalanceLoading(false)
      return
    }

    let cancelled = false
    setBalanceLoading(true)
    void provider.request({ method: "eth_getBalance", params: [account, "latest"] })
      .then((value) => {
        if (!cancelled) setNativeBalanceWei(asRpcQuantity(value, "余额"))
      })
      .catch(() => {
        if (!cancelled) setNativeBalanceWei(null)
      })
      .finally(() => {
        if (!cancelled) setBalanceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [account, onSelectedNetwork, selectedNetwork.chainId])

  React.useEffect(() => {
    const provider = getProvider()
    if (!provider?.on) return

    const handleAccountsChanged = (value: unknown) => {
      const accounts = Array.isArray(value) ? value.filter((account): account is string => typeof account === "string") : []
      setAccount(accounts[0] ?? null)
      setPlan(null)
      setContractPlan(null)
    }
    const handleChainChanged = (value: unknown) => {
      const chainId = toChainId(value)
      setConnectedChainId(chainId)
      if (chainId && NETWORKS.some((network) => network.chainId === chainId)) setSelectedChainId(String(chainId))
      setPlan(null)
      setContractPlan(null)
    }
    provider.on("accountsChanged", handleAccountsChanged)
    provider.on("chainChanged", handleChainChanged)

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged)
      provider.removeListener?.("chainChanged", handleChainChanged)
    }
  }, [])

  async function connectWallet() {
    const provider = getProvider()
    if (!provider) {
      toast.error("未检测到浏览器钱包，请安装或启用 MetaMask、Rabby 等 EVM 钱包。")
      return
    }

    setConnecting(true)
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" })
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("钱包没有返回可用账户。")
      const chainId = toChainId(await provider.request({ method: "eth_chainId" }))
      setAccount(accounts[0])
      setConnectedChainId(chainId)
      if (chainId && NETWORKS.some((network) => network.chainId === chainId)) setSelectedChainId(String(chainId))
      toast.success("钱包已连接")
    } catch (error) {
      toast.error(providerError(error, "连接钱包失败。"))
    } finally {
      setConnecting(false)
    }
  }

  function disconnectWallet() {
    setAccount(null)
    setConnectedChainId(null)
    setPlan(null)
    setTransactionHash(null)
    setContractPlan(null)
    setContractTransactionHash(null)
    toast.success("已断开当前面板的钱包连接")
  }

  async function switchNetwork(value: string | null) {
    if (!value) return
    setSelectedChainId(value)
    setPlan(null)
    setContractPlan(null)
    if (!account) return

    const provider = getProvider()
    const network = NETWORKS.find((item) => item.chainId === Number(value))
    if (!provider || !network || connectedChainId === network.chainId) return

    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toRpcQuantity(BigInt(network.chainId)) }] })
      setConnectedChainId(network.chainId)
      toast.success(`已切换至 ${network.name}`)
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
      toast.error(code === 4902 ? `请先在钱包中添加 ${network.name} 网络。` : providerError(error, "切换网络失败。"))
    }
  }

  async function calculatePlan() {
    const provider = getProvider()
    if (!provider || !account) {
      toast.error("请先连接钱包。")
      return null
    }
    if (!onSelectedNetwork) {
      toast.error(`请先将钱包切换至 ${selectedNetwork.name}。`)
      return null
    }
    if (!strictSweepSupported) {
      toast.error(`${selectedNetwork.name} 存在额外网络费用，暂不支持严格归零。`)
      return null
    }
    if (!isEvmAddress(destination)) {
      toast.error("请输入有效的 EVM 收款地址。")
      return null
    }

    setCalculating(true)
    try {
      const nextPlan = await createStrictSweepPlan(provider, account, destination.trim(), selectedNetwork)
      setPlan(nextPlan)
      setTransactionHash(null)
      return nextPlan
    } catch (error) {
      setPlan(null)
      toast.error(providerError(error, "无法计算 Sweep 金额。"))
      return null
    } finally {
      setCalculating(false)
    }
  }

  async function openConfirmation() {
    const nextPlan = await calculatePlan()
    if (nextPlan) setConfirmOpen(true)
  }

  async function submitSweep() {
    const provider = getProvider()
    if (!provider || !account) return
    if (!strictSweepSupported) {
      setConfirmOpen(false)
      toast.error(`${selectedNetwork.name} 暂不支持严格归零。`)
      return
    }
    setSubmitting(true)
    try {
      // Do not use a stale preview: re-run every strict-emptying check at confirmation time.
      const finalPlan = await createStrictSweepPlan(provider, account, destination.trim(), selectedNetwork)
      setPlan(finalPlan)
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: destination.trim(),
          value: toRpcQuantity(finalPlan.transferableWei),
          gas: toRpcQuantity(finalPlan.gasLimit),
          gasPrice: toRpcQuantity(finalPlan.gasPriceWei),
        }],
      })
      if (typeof hash !== "string") throw new Error("钱包未返回交易哈希。")
      setTransactionHash(hash)
      setConfirmOpen(false)
      toast.success("Sweep 交易已提交，等待链上确认。")
    } catch (error) {
      toast.error(providerError(error, "Sweep 交易未能提交。"))
    } finally {
      setSubmitting(false)
    }
  }

  function generateCalldata() {
    try {
      const nextCalldata = encodeFunctionCalldata(functionSignature, functionArguments)
      setContractCalldata(nextCalldata)
      setContractPlan(null)
      toast.success("Calldata 已生成并填入交互请求。")
    } catch (error) {
      toast.error(providerError(error, "无法生成 calldata。"))
    }
  }

  function getContractRequest() {
    if (!isEvmAddress(contractAddress)) throw new Error("请输入有效的合约地址。")
    if (!isHexCalldata(contractCalldata)) throw new Error("Calldata 必须是偶数字节的 0x 十六进制数据。")

    return {
      contractAddress: contractAddress.trim(),
      calldata: contractCalldata.trim(),
      valueWei: parseNativeValue(contractValue),
    }
  }

  async function calculateContractPlan() {
    const provider = getProvider()
    if (!provider || !account) {
      toast.error("请先连接钱包。")
      return null
    }
    if (!onSelectedNetwork) {
      toast.error(`请先将钱包切换至 ${selectedNetwork.name}。`)
      return null
    }

    setContractCalculating(true)
    try {
      const request = getContractRequest()
      const nextPlan = await createContractInteractionPlan(provider, account, request.contractAddress, request.calldata, request.valueWei, selectedNetwork)
      setContractPlan(nextPlan)
      setContractTransactionHash(null)
      return nextPlan
    } catch (error) {
      setContractPlan(null)
      toast.error(providerError(error, "无法估算合约交互。"))
      return null
    } finally {
      setContractCalculating(false)
    }
  }

  async function openContractConfirmation() {
    const nextPlan = await calculateContractPlan()
    if (nextPlan) setContractConfirmOpen(true)
  }

  async function submitContractInteraction() {
    const provider = getProvider()
    if (!provider || !account) return

    setContractSubmitting(true)
    try {
      const request = getContractRequest()
      const finalPlan = await createContractInteractionPlan(provider, account, request.contractAddress, request.calldata, request.valueWei, selectedNetwork)
      setContractPlan(finalPlan)
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: finalPlan.contractAddress,
          data: finalPlan.calldata,
          value: toRpcQuantity(finalPlan.valueWei),
          gas: toRpcQuantity(finalPlan.gasLimit),
          gasPrice: toRpcQuantity(finalPlan.gasPriceWei),
        }],
      })
      if (typeof hash !== "string") throw new Error("钱包未返回交易哈希。")
      setContractTransactionHash(hash)
      setContractConfirmOpen(false)
      toast.success("合约交互已提交，等待链上确认。")
    } catch (error) {
      toast.error(providerError(error, "合约交互未能提交。"))
    } finally {
      setContractSubmitting(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs text-muted-foreground">WALLET</p>
          <h1 className="mt-1 text-xl font-medium">钱包</h1>
          <p className="mt-1 text-sm text-muted-foreground">连接浏览器钱包后，可在指定网络将全部可转原生代币汇集至一个地址。</p>
        </div>
        {account ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-auto max-w-full gap-2 px-2.5 py-1 font-mono break-all"><span className="size-1.5 shrink-0 bg-emerald-500" />{account}</Badge>
            <Button variant="outline" onClick={disconnectWallet}><LogOut />断开连接</Button>
          </div>
        ) : (
          <Button onClick={connectWallet} disabled={connecting}>{connecting ? <LoaderCircle className="animate-spin" /> : <WalletCards />}连接钱包</Button>
        )}
      </section>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>原生代币 Sweeper</CardTitle>
          <CardDescription>{strictSweepSupported ? "严格归零模式：只向普通地址发送，固定 21,000 Gas，目标是将当前网络的原生代币清空。" : `${selectedNetwork.name} 的费用含额外网络成本；为避免错误归零，本版本仅支持查看余额。`}</CardDescription>
          <CardAction><Badge variant={account && strictSweepSupported ? "outline" : "destructive"} className={account && strictSweepSupported ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}>{account ? strictSweepSupported ? "严格归零" : "暂不支持" : "未连接"}</Badge></CardAction>
        </CardHeader>
        <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <Label htmlFor="wallet-network">网络</Label>
              <Select value={selectedChainId} onValueChange={switchNetwork} disabled={!account}>
                <SelectTrigger id="wallet-network" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>{NETWORKS.map((network) => <SelectItem key={network.chainId} value={String(network.chainId)}>{network.name} · {network.symbol}</SelectItem>)}</SelectContent>
              </Select>
              {!account ? <p className="text-xs text-muted-foreground">连接钱包后即可选择并切换网络。</p> : !onSelectedNetwork ? <p className="text-xs text-amber-700 dark:text-amber-400">钱包当前在 {connectedNetwork?.name ?? "未支持网络"}，请先切换到 {selectedNetwork.name}。</p> : <><div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-l-2 border-emerald-500/60 bg-emerald-500/5 px-2 py-1.5 text-xs"><span className="text-muted-foreground">当前余额 · {selectedNetwork.symbol}</span><span className="font-mono break-all">{balanceLoading ? "正在读取…" : nativeBalanceWei === null ? "无法读取余额" : `${formatExactNativeAmount(nativeBalanceWei)} ${selectedNetwork.symbol}`}</span></div>{!strictSweepSupported && <p className="text-xs text-amber-700 dark:text-amber-400">该网络包含额外数据或网络费用，严格归零已安全禁用。</p>}</>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sweep-destination">收款地址</Label>
              <Input id="sweep-destination" value={destination} onChange={(event) => { setDestination(event.target.value); setPlan(null) }} placeholder="0x…" spellCheck={false} autoComplete="off" />
              <p className="text-xs text-muted-foreground">仅支持普通 EVM 地址（EOA）；合约地址会被严格归零模式拒绝。交易发送后无法撤销，请逐字确认地址。</p>
            </div>
            {strictSweepSupported ? <><div className="border border-amber-500/35 bg-amber-500/5 p-3 text-xs leading-5 text-amber-950 dark:text-amber-100"><div className="flex items-center gap-2 font-medium"><CircleAlert className="size-4" />严格归零条件</div><p className="mt-1">确认前会检查收款地址为普通地址、当前账户没有待确认交易，并固定使用 21,000 Gas。钱包确认页请勿修改 Gas 或手续费参数。</p></div><Button className="w-full sm:w-fit" onClick={openConfirmation} disabled={!account || !onSelectedNetwork || calculating}>{calculating ? <LoaderCircle className="animate-spin" /> : <Check />}检查并确认归零</Button></> : <div className="border border-dashed p-3 text-xs leading-5 text-muted-foreground">当前网络仅提供完整余额查看。L1 数据费或其他附加费会使固定 21,000 Gas 的归零计算不可靠。</div>}
          </div>

          <div className="border bg-muted/20 p-4">
            <p className="text-sm font-medium">本次计算</p>
            {plan ? (
              <dl className="mt-4 grid gap-3 text-xs">
                <div className="flex items-start justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">当前余额</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(plan.balanceWei)} {plan.network.symbol}</dd></div>
                <div className="flex items-start justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">Gas Price</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(plan.gasPriceWei)} {plan.network.symbol}</dd></div>
                <div className="flex items-center justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">固定 Gas</dt><dd className="font-mono">{plan.gasLimit.toString()}</dd></div>
                <div className="flex items-start justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">预计手续费</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(plan.gasFeeWei)} {plan.network.symbol}</dd></div>
                <div className="flex items-start justify-between gap-3 border-b pb-2 text-sm font-medium"><dt>预计转出</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(plan.transferableWei)} {plan.network.symbol}</dd></div>
                <div className="flex items-start justify-between gap-3 pt-1"><dt className="text-muted-foreground">预计剩余</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(plan.remainingWei)} {plan.network.symbol}</dd></div>
              </dl>
            ) : <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><WalletCards className="size-6" /><p>{strictSweepSupported ? "连接钱包并输入收款地址后，检查归零条件。" : "该网络暂不提供严格归零。"}</p></div>}
            {transactionHash && <div className="mt-4 border border-emerald-500/35 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300"><div className="flex items-center gap-2 font-medium"><Check className="size-4" />交易已提交</div><p className="mt-1 break-all font-mono">{transactionHash}</p></div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>合约交互</CardTitle>
          <CardDescription>向当前网络的合约发送 calldata；所有交易均由浏览器钱包确认，本面板不会读取或保存私钥。</CardDescription>
          <CardAction><Badge variant="outline" className="border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-400">手动确认</Badge></CardAction>
        </CardHeader>
        <CardContent className="grid gap-5 pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contract-address">合约地址</Label>
              <Input id="contract-address" value={contractAddress} onChange={(event) => { setContractAddress(event.target.value); setContractPlan(null) }} placeholder="0x…" spellCheck={false} autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contract-calldata">Calldata</Label>
              <Textarea id="contract-calldata" value={contractCalldata} onChange={(event) => { setContractCalldata(event.target.value); setContractPlan(null) }} className="min-h-28 font-mono break-all" placeholder="0x…" spellCheck={false} />
              <p className="text-xs text-muted-foreground">仅发送你填写的数据。请先自行核对目标合约和函数语义。</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="contract-value">附带原生币（可选）</Label>
              <Input id="contract-value" value={contractValue} onChange={(event) => { setContractValue(event.target.value); setContractPlan(null) }} inputMode="decimal" placeholder={`例如：0.01 ${selectedNetwork.symbol}`} />
              <p className="text-xs text-muted-foreground">留空即为 0；最多 18 位小数。</p>
            </div>

            <div className="grid gap-3 border border-sky-500/25 bg-sky-500/5 p-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Code2 className="size-4 text-sky-700 dark:text-sky-400" />函数签名生成器</div>
              <div className="grid gap-2"><Label htmlFor="function-signature">函数签名</Label><Input id="function-signature" value={functionSignature} onChange={(event) => setFunctionSignature(event.target.value)} placeholder="例如：transfer(address,uint256)" /></div>
              <div className="grid gap-2"><Label htmlFor="function-arguments">参数（JSON 数组）</Label><Textarea id="function-arguments" value={functionArguments} onChange={(event) => setFunctionArguments(event.target.value)} className="min-h-20 font-mono" placeholder='例如：["0x…", "1000000"]' spellCheck={false} /><p className="text-xs text-muted-foreground">整数请使用字符串，避免浏览器数字精度丢失。</p></div>
              <Button type="button" variant="outline" className="w-full sm:w-fit" onClick={generateCalldata}><Braces />生成 Calldata</Button>
            </div>
            <Button className="w-full sm:w-fit" onClick={openContractConfirmation} disabled={!account || !onSelectedNetwork || contractCalculating}>{contractCalculating ? <LoaderCircle className="animate-spin" /> : <Send />}估算并确认合约交互</Button>
          </div>

          <div className="border bg-muted/20 p-4">
            <p className="text-sm font-medium">交互预估</p>
            {contractPlan ? (
              <dl className="mt-4 grid gap-3 text-xs">
                <div className="grid gap-1 border-b pb-2"><dt className="text-muted-foreground">合约地址</dt><dd className="break-all font-mono">{contractPlan.contractAddress}</dd></div>
                <div className="grid gap-1 border-b pb-2"><dt className="text-muted-foreground">Calldata</dt><dd className="max-h-28 overflow-y-auto break-all font-mono">{contractPlan.calldata}</dd></div>
                <div className="flex items-start justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">附带原生币</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(contractPlan.valueWei)} {contractPlan.network.symbol}</dd></div>
                <div className="flex items-center justify-between gap-3 border-b pb-2"><dt className="text-muted-foreground">估算 Gas</dt><dd className="font-mono">{contractPlan.gasLimit.toString()}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Gas Price</dt><dd className="max-w-[65%] break-all text-right font-mono">{formatExactNativeAmount(contractPlan.gasPriceWei)} {contractPlan.network.symbol}</dd></div>
              </dl>
            ) : <div className="flex min-h-72 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><Code2 className="size-6" /><p>填写合约地址和 calldata 后，估算本次交互。</p></div>}
            {contractTransactionHash && <div className="mt-4 border border-emerald-500/35 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300"><div className="flex items-center gap-2 font-medium"><Check className="size-4" />合约交互已提交</div><p className="mt-1 break-all font-mono">{contractTransactionHash}</p></div>}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认发起 Sweep？</AlertDialogTitle>
            <AlertDialogDescription>将把 {plan ? `${formatExactNativeAmount(plan.transferableWei)} ${plan.network.symbol}` : "当前全部可转原生代币"} 发送至 {shortAddress(destination.trim() || "0x0000000000000000000000000000000000000000")}。确认后会立即复查余额、Gas Price、普通地址状态和待确认交易。钱包确认页请勿修改 21,000 Gas 或手续费参数。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={submitSweep} disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : <ExternalLink />}{submitting ? "正在请求钱包确认" : "确认并发起交易"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={contractConfirmOpen} onOpenChange={setContractConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认合约交互？</AlertDialogTitle>
            <AlertDialogDescription>这会向指定合约发送你填写的 calldata。确认后会重新估算 Gas，并在钱包中请求签名；请不要在不理解函数效果的情况下继续。</AlertDialogDescription>
          </AlertDialogHeader>
          {contractPlan && <div className="grid max-h-48 gap-2 overflow-y-auto border bg-muted/30 p-3 text-xs"><div><p className="text-muted-foreground">合约地址</p><p className="break-all font-mono">{contractPlan.contractAddress}</p></div><div><p className="text-muted-foreground">Calldata</p><p className="break-all font-mono">{contractPlan.calldata}</p></div><div><p className="text-muted-foreground">附带原生币</p><p className="font-mono">{formatExactNativeAmount(contractPlan.valueWei)} {contractPlan.network.symbol}</p></div></div>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={contractSubmitting}>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={submitContractInteraction} disabled={contractSubmitting}>{contractSubmitting ? <LoaderCircle className="animate-spin" /> : <ExternalLink />}{contractSubmitting ? "正在请求钱包确认" : "确认并发起交易"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
