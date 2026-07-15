import * as React from "react"
import {
  Check,
  CircleAlert,
  Download,
  LoaderCircle,
  Pencil,
  PhoneCall,
  Plus,
  Send,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Switch } from "~/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import type {
  AlertDirection,
  AlertRule,
  AlertRuleConfig,
  BasketMember,
  FwAlertSettingsStatus,
  MarketSnapshot,
  NotificationChannel,
  RuleExportFile,
  SpotMarket,
  SpotSymbol,
  TelegramSettingsStatus,
} from "~/lib/price-alert.types"

type PageData = {
  symbols: Record<SpotMarket, SpotSymbol[]>
  rules: AlertRule[]
  telegram: TelegramSettingsStatus
  fwalert: FwAlertSettingsStatus
}

type AlertCondition = AlertDirection | "interval" | "basket" | null

function marketLabel(market: SpotMarket) {
  return market === "okx" ? "OKX 现货" : "Binance 现货"
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? "请求失败。")
  return body
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value))
    : "未触发"
}

function formatPrice(value: string | null) {
  if (!value) return "—"
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toLocaleString(undefined, { maximumFractionDigits: 12 }) : value
}

function toRuleConfig(rule: AlertRule): AlertRuleConfig {
  return {
    market: rule.market,
    symbol: rule.symbol,
    triggerType: rule.triggerType,
    direction: rule.direction,
    targetPrice: rule.targetPrice,
    interval: rule.interval,
    intervalResetRange: rule.intervalResetRange,
    basketMembers: rule.basketMembers,
    deviationPercent: rule.deviationPercent,
    channels: rule.channels,
    enabled: rule.enabled,
  }
}

export function PriceMonitoringClient() {
  const [initialData, setInitialData] = React.useState<PageData>({
    symbols: { binance: [], okx: [] },
    rules: [],
    telegram: { configured: false, chatId: null, token: null, updatedAt: null, encryptionReady: true },
    fwalert: { configured: false, url: null, updatedAt: null, encryptionReady: true },
  })
  const [rules, setRules] = React.useState<AlertRule[]>([])
  const [telegram, setTelegram] = React.useState<TelegramSettingsStatus>({ configured: false, chatId: null, token: null, updatedAt: null, encryptionReady: true })
  const [fwalert, setFwalert] = React.useState<FwAlertSettingsStatus>({ configured: false, url: null, updatedAt: null, encryptionReady: true })
  const [monitorError, setMonitorError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<AlertRule | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [token, setToken] = React.useState("")
  const [chatId, setChatId] = React.useState("")
  const [fwalertUrl, setFwalertUrl] = React.useState("")
  const [market, setMarket] = React.useState<SpotMarket>("binance")
  const [symbol, setSymbol] = React.useState("")
  const [pairQuery, setPairQuery] = React.useState("")
  const [direction, setDirection] = React.useState<AlertDirection>("above")
  const [targetPrice, setTargetPrice] = React.useState("")
  const [interval, setInterval] = React.useState("")
  const [intervalResetRange, setIntervalResetRange] = React.useState("")
  const [condition, setCondition] = React.useState<AlertCondition>(null)
  const [channels, setChannels] = React.useState<NotificationChannel[]>(["telegram"])
  const [pairPickerOpen, setPairPickerOpen] = React.useState(false)
  const [basketMarket, setBasketMarket] = React.useState<SpotMarket>("binance")
  const [basketSymbol, setBasketSymbol] = React.useState("")
  const [basketPairQuery, setBasketPairQuery] = React.useState("")
  const [basketPickerOpen, setBasketPickerOpen] = React.useState(false)
  const [basketMembers, setBasketMembers] = React.useState<BasketMember[]>([])
  const [deviationPercent, setDeviationPercent] = React.useState("")
  const importInputRef = React.useRef<HTMLInputElement>(null)

  const refresh = React.useCallback(async () => {
    try {
      const snapshot = await requestJson<MarketSnapshot>("/api/market/snapshot")
      setRules(snapshot.rules)
      setMonitorError(snapshot.monitorError)
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : "无法刷新行情。")
    }
  }, [])

  React.useEffect(() => {
    void (async () => {
      try {
        const dashboard = await requestJson<PageData>("/api/dashboard")
        setInitialData(dashboard)
        setRules(dashboard.rules)
        setTelegram(dashboard.telegram)
        setFwalert(dashboard.fwalert)
        setToken(dashboard.telegram.token ?? "")
        setChatId(dashboard.telegram.chatId ?? "")
        setFwalertUrl(dashboard.fwalert.url ?? "")
      } catch (error) {
        setMonitorError(error instanceof Error ? error.message : "无法加载监控配置。")
      }
    })()
    const timer = window.setInterval(() => void refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  function openCreate() {
    setEditing(null)
    setMarket("binance")
    setSymbol("")
    setPairQuery("")
    setDirection("above")
    setTargetPrice("")
    setInterval("")
    setIntervalResetRange("200")
    setCondition(null)
    setChannels(["telegram"])
    setBasketMarket("binance")
    setBasketSymbol("")
    setBasketPairQuery("")
    setBasketMembers([])
    setDeviationPercent("")
    setDialogOpen(true)
  }

  function openEdit(rule: AlertRule) {
    setEditing(rule)
    setMarket(rule.market)
    setSymbol(rule.symbol)
    setPairQuery(rule.symbol)
    setDirection(rule.direction)
    setTargetPrice(rule.targetPrice)
    setInterval(rule.interval ?? "")
    setIntervalResetRange(rule.intervalResetRange)
    setCondition(rule.triggerType === "interval" ? "interval" : rule.direction)
    setChannels(rule.channels)
    setBasketMarket("binance")
    setBasketSymbol("")
    setBasketPairQuery("")
    setBasketMembers(rule.basketMembers)
    setDeviationPercent(rule.deviationPercent ?? "")
    if (rule.triggerType === "basket") setCondition("basket")
    setDialogOpen(true)
  }

  function updatePairQuery(value: string) {
    const query = value.toUpperCase()
    const exactSymbol = initialData.symbols[market].find((pair) => pair.symbol === query)?.symbol ?? ""
    setPairQuery(query)
    setSymbol(exactSymbol)
    if (exactSymbol) setBasketMembers((current) => current.filter((member) => member.market !== market || member.symbol !== exactSymbol))
    setPairPickerOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById("symbol-search")?.closest('[data-slot="command"]')?.querySelector<HTMLElement>('[data-slot="command-list"]')?.scrollTo({ top: 0 })
    })
  }

  function updateBasketPairQuery(value: string) {
    const query = value.toUpperCase()
    const exactSymbol = initialData.symbols[basketMarket].find((pair) => pair.symbol === query)?.symbol ?? ""
    setBasketPairQuery(query)
    setBasketSymbol(exactSymbol)
    setBasketPickerOpen(true)
    window.requestAnimationFrame(() => {
      document.getElementById("basket-symbol-search")?.closest('[data-slot="command"]')?.querySelector<HTMLElement>('[data-slot="command-list"]')?.scrollTo({ top: 0 })
    })
  }

  function addBasketMember() {
    if (!basketSymbol) return
    const member = { market: basketMarket, symbol: basketSymbol }
    if (member.market === market && member.symbol === symbol) {
      toast.error("篮子成员不能与锚点相同")
      return
    }
    if (basketMembers.some((item) => item.market === member.market && item.symbol === member.symbol)) {
      toast.error("该交易对已在篮子中")
      return
    }
    setBasketMembers((current) => [...current, member])
    setBasketSymbol("")
    setBasketPairQuery("")
    setBasketPickerOpen(false)
  }

  async function saveTelegram() {
    setSaving(true)
    try {
      const result = await requestJson<{ telegram: TelegramSettingsStatus }>("/api/telegram-settings", {
        method: "POST",
        body: JSON.stringify({ token, chatId }),
      })
      setTelegram(result.telegram)
      setToken(result.telegram.token ?? "")
      toast.success("Telegram 配置已保存")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function testTelegram() {
    setSaving(true)
    try {
      await requestJson("/api/telegram-settings/test", { method: "POST", body: "{}" })
      toast.success("测试消息已发送")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试发送失败")
    } finally {
      setSaving(false)
    }
  }

  async function saveFwalert() {
    setSaving(true)
    try {
      const result = await requestJson<{ fwalert: FwAlertSettingsStatus }>("/api/fwalert-settings", {
        method: "POST",
        body: JSON.stringify({ url: fwalertUrl }),
      })
      setFwalert(result.fwalert)
      setFwalertUrl(result.fwalert.url ?? "")
      toast.success("FwAlert 电话渠道已保存")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function testFwalert() {
    setSaving(true)
    try {
      await requestJson("/api/fwalert-settings/test", { method: "POST", body: "{}" })
      toast.success("电话测试请求已发送")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "电话测试失败")
    } finally {
      setSaving(false)
    }
  }

  async function saveRule() {
    setSaving(true)
    try {
      const url = editing ? `/api/alert-rules/${editing.id}` : "/api/alert-rules"
      const result = await requestJson<{ rule: AlertRule }>(url, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          symbol,
          market,
          triggerType: condition === "interval" ? "interval" : condition === "basket" ? "basket" : "target",
          direction: condition === "above" || condition === "below" ? condition : "above",
          targetPrice: condition === "interval" || condition === "basket" ? undefined : targetPrice,
          interval: condition === "interval" ? interval : undefined,
          intervalResetRange: condition === "interval" ? intervalResetRange : undefined,
          basketMembers: condition === "basket" ? basketMembers : undefined,
          deviationPercent: condition === "basket" ? deviationPercent : undefined,
          channels,
        }),
      })
      setRules((current) => editing
        ? current.map((rule) => rule.id === result.rule.id ? result.rule : rule)
        : [result.rule, ...current])
      setDialogOpen(false)
      toast.success(editing ? "规则已更新" : "监控规则已创建")
      void refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法保存规则")
    } finally {
      setSaving(false)
    }
  }

  async function patchRule(id: number, values: Partial<AlertRule>) {
    try {
      const result = await requestJson<{ rule: AlertRule }>(`/api/alert-rules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: values.enabled,
          market: values.market,
          symbol: values.symbol,
          triggerType: values.triggerType,
          direction: values.direction,
          targetPrice: values.targetPrice,
          interval: values.interval,
          intervalResetRange: values.intervalResetRange,
          basketMembers: values.basketMembers,
          deviationPercent: values.deviationPercent,
          channels: values.channels,
        }),
      })
      setRules((current) => current.map((rule) => rule.id === id ? result.rule : rule))
      toast.success("规则状态已更新")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败")
      void refresh()
    }
  }

  async function removeRule(id: number) {
    try {
      await requestJson(`/api/alert-rules/${id}`, { method: "DELETE" })
      setRules((current) => current.filter((rule) => rule.id !== id))
      toast.success("规则已删除")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败")
    }
  }

  function exportRules() {
    const payload: RuleExportFile = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rules: rules.map(toRuleConfig),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `dashboard-rules-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${rules.length} 条规则`)
  }

  async function importRules(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > 1_000_000) {
      toast.error("导入文件不能超过 1 MB")
      return
    }
    setSaving(true)
    try {
      const payload = JSON.parse(await file.text()) as RuleExportFile
      const result = await requestJson<{ rules: AlertRule[] }>("/api/alert-rules/import", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      setRules((current) => [...result.rules, ...current].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
      toast.success(`已导入 ${result.rules.length} 条规则`)
      void refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入规则失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <Input ref={importInputRef} className="hidden" type="file" accept="application/json,.json" onChange={(event) => void importRules(event)} />
      <section className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs text-muted-foreground">BINANCE / OKX SPOT · 5 秒刷新</p>
          <h1 className="mt-1 text-xl font-medium">价格监控</h1>
          <p className="mt-1 text-sm text-muted-foreground">配置 Telegram 渠道，并为现货交易对设置价格穿越提醒。</p>
        </div>
        <Button onClick={openCreate}><Plus /> 新建监控规则</Button>
      </section>

      {monitorError && (
        <div className="flex items-center gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <CircleAlert className="size-4" /> {monitorError}
        </div>
      )}

      <section className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div>
            <CardTitle>Telegram 推送渠道</CardTitle>
            <CardDescription>使用 Bot Token 和 Chat ID 接收价格穿越提醒。</CardDescription>
          </div><Badge variant="outline" className={telegram.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}>{telegram.configured ? "已配置" : "未配置"}</Badge></CardHeader>
          <CardContent className="grid gap-4">
            {!telegram.encryptionReady && (
              <p className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">服务端缺少 DASHBOARD_ENCRYPTION_KEY，暂不能保存 Token。</p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="bot-token">Bot Token</Label>
              <Input id="bot-token" value={token} onChange={(event) => setToken(event.target.value)} placeholder="123456:ABC-DEF..." autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="chat-id">Chat ID</Label>
              <Input id="chat-id" value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder="例如：-1001234567890" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveTelegram()} disabled={saving || !telegram.encryptionReady}><Check /> 保存配置</Button>
              <Button variant="outline" onClick={() => void testTelegram()} disabled={saving || !telegram.configured}><Send /> 发送测试</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0"><div>
            <CardTitle>FwAlert 电话渠道</CardTitle>
            <CardDescription>保存平台提供的电话推送链接；每次调用由平台决定是否触发电话。</CardDescription>
          </div><Badge variant="outline" className={fwalert.configured ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}>{fwalert.configured ? "已配置" : "未配置"}</Badge></CardHeader>
          <CardContent className="grid gap-4">
            {!fwalert.encryptionReady && (
              <p className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">服务端缺少 DASHBOARD_ENCRYPTION_KEY，暂不能保存电话链接。</p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="fwalert-url">电话推送链接</Label>
              <Input id="fwalert-url" type="url" value={fwalertUrl} onChange={(event) => setFwalertUrl(event.target.value)} placeholder="https://fwalert.com/..." autoComplete="off" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveFwalert()} disabled={saving || !fwalert.encryptionReady}><Check /> 保存配置</Button>
              <Button variant="outline" onClick={() => void testFwalert()} disabled={saving || !fwalert.configured}><PhoneCall /> 电话测试</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>运行状态</CardTitle>
            <CardDescription>服务端持续检查启用规则，首次读取价格不会推送。</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric label="监控规则" value={String(rules.length)} />
            <Metric label="启用中" value={String(rules.filter((rule) => rule.enabled).length)} />
            <Metric label="推送渠道" value={`${Number(telegram.configured) + Number(fwalert.configured)} 已配置`} />
          </CardContent>
        </Card>
      </section>

      <Card className="min-h-72">
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0"><div className="flex items-center gap-2"><CardTitle>监控规则</CardTitle><Badge variant="outline">{rules.filter((rule) => rule.enabled).length} active</Badge></div>
            <CardDescription className="mt-1">导入会新增规则而不会删除当前配置；仅在条件首次满足时发送提醒。</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:justify-end"><Button size="sm" variant="outline" onClick={exportRules}><Download /> 导出</Button><Button size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={saving}><Upload /> 导入</Button></div>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed text-center">
              <p className="text-sm">尚未创建监控规则</p>
              <Button variant="outline" onClick={openCreate}><Plus /> 添加第一条规则</Button>
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>市场</TableHead><TableHead>交易对</TableHead><TableHead>最新价</TableHead><TableHead>条件</TableHead><TableHead>目标价</TableHead><TableHead>通知渠道</TableHead><TableHead>状态</TableHead><TableHead>最后触发</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
              <TableBody>{rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell><Badge variant="outline">{marketLabel(rule.market)}</Badge></TableCell>
                  <TableCell className="font-medium">{rule.symbol}{rule.triggerType === "basket" && <span className="ml-1 text-xs font-normal text-muted-foreground">+{rule.basketMembers.length}</span>}</TableCell>
                  <TableCell>{formatPrice(rule.lastPrice)}</TableCell>
                  <TableCell><Badge variant="outline" className={rule.triggerType === "interval" ? "" : rule.triggerType === "basket" ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300" : rule.direction === "above" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"}>{rule.triggerType === "interval" ? "整数倍价位" : rule.triggerType === "basket" ? "篮子偏离" : rule.direction === "above" ? "上穿" : "下穿"}</Badge></TableCell>
                  <TableCell>{rule.triggerType === "interval" ? `每 ${formatPrice(rule.interval ?? rule.targetPrice)} / ±${formatPrice(rule.intervalResetRange)}` : rule.triggerType === "basket" ? `±${rule.deviationPercent}% · ${rule.basketMembers.length} 个成员` : formatPrice(rule.targetPrice)}</TableCell>
                  <TableCell><div className="flex gap-1">{rule.channels.map((channel) => <Badge key={channel} variant="outline" className={channel === "telegram" ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}>{channel === "telegram" ? "Telegram" : "电话"}</Badge>)}</div></TableCell>
                  <TableCell><Switch checked={rule.enabled} onCheckedChange={(enabled) => void patchRule(rule.id, { enabled })} aria-label={`切换 ${rule.symbol} 规则`} /></TableCell>
                  <TableCell className="text-muted-foreground">{rule.lastError ? <span className="text-destructive" title={rule.lastError}>推送失败</span> : formatDate(rule.lastTriggeredAt)}</TableCell>
                  <TableCell><div className="flex gap-1"><Button size="icon-xs" variant="ghost" onClick={() => openEdit(rule)} aria-label="编辑规则"><Pencil /></Button><Button size="icon-xs" variant="ghost" onClick={() => void removeRule(rule.id)} aria-label="删除规则"><Trash2 /></Button></div></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "编辑监控规则" : "新建监控规则"}</DialogTitle><DialogDescription>价格首次进入监控范围只作为基准，不会发送消息。</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2"><Label>监控类型</Label><Select value={condition ?? ""} onValueChange={(value) => setCondition(value as AlertCondition)}><SelectTrigger className="w-full"><SelectValue>{(value: AlertCondition) => value === "above" ? "上穿目标价" : value === "below" ? "下穿目标价" : value === "interval" ? "整数倍价位" : value === "basket" ? "篮子偏离" : "选择监控类型"}</SelectValue></SelectTrigger><SelectContent align="start" alignItemWithTrigger={false}><SelectItem value="above">上穿目标价</SelectItem><SelectItem value="below">下穿目标价</SelectItem><SelectItem value="interval">整数倍价位</SelectItem><SelectItem value="basket">篮子偏离</SelectItem></SelectContent></Select></div>
            {condition && <><div className="grid gap-2"><Label>{condition === "basket" ? "锚点交易所" : "交易所"}</Label><Select value={market} onValueChange={(value) => { setMarket(value as SpotMarket); setSymbol(""); setPairQuery(""); setPairPickerOpen(false) }}><SelectTrigger className="w-full"><SelectValue>{(value: SpotMarket | null) => value ? marketLabel(value) : "选择交易所"}</SelectValue></SelectTrigger><SelectContent align="start" alignItemWithTrigger={false}><SelectItem value="binance">Binance 现货</SelectItem><SelectItem value="okx">OKX 现货</SelectItem></SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="symbol-search">{marketLabel(market)}交易对</Label><Command className="relative overflow-visible border bg-background"><CommandInput id="symbol-search" value={pairQuery} onValueChange={updatePairQuery} onFocus={() => setPairPickerOpen(true)} onBlur={() => window.setTimeout(() => setPairPickerOpen(false), 120)} placeholder={market === "okx" ? "搜索 BTC-USDT、BTC 或 USDT" : "搜索 BTCUSDT、BTC 或 USDT"} />{pairPickerOpen && <CommandList key={`${market}:${pairQuery}`} className="absolute top-full z-50 mt-1 max-h-52 w-full border bg-popover shadow-md"><CommandEmpty>未找到交易对</CommandEmpty><CommandGroup>{initialData.symbols[market].map((pair) => <CommandItem key={pair.symbol} value={`${pair.symbol} ${pair.baseAsset} ${pair.quoteAsset}`} onMouseDown={(event) => event.preventDefault()} onSelect={() => { setSymbol(pair.symbol); setPairQuery(pair.symbol); setBasketMembers((current) => current.filter((member) => member.market !== market || member.symbol !== pair.symbol)); setPairPickerOpen(false) }}><span>{pair.symbol}</span><span className="ml-auto text-muted-foreground">{pair.baseAsset}/{pair.quoteAsset}</span></CommandItem>)}</CommandGroup></CommandList>}</Command></div>
            {condition === "basket" ? <div className="grid gap-3 border border-violet-500/20 bg-violet-500/5 p-3"><div className="grid gap-1"><p className="text-sm font-medium">锚点</p><p className="text-xs text-muted-foreground">上方已选交易所和交易对作为基准价格。</p></div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-2"><Label>篮子交易所</Label><Select value={basketMarket} onValueChange={(value) => { setBasketMarket(value as SpotMarket); setBasketSymbol(""); setBasketPairQuery(""); setBasketPickerOpen(false) }}><SelectTrigger className="w-full"><SelectValue>{(value: SpotMarket | null) => value ? marketLabel(value) : "选择交易所"}</SelectValue></SelectTrigger><SelectContent align="start" alignItemWithTrigger={false}><SelectItem value="binance">Binance 现货</SelectItem><SelectItem value="okx">OKX 现货</SelectItem></SelectContent></Select></div><Button type="button" className="self-end" variant="outline" onClick={addBasketMember} disabled={!basketSymbol}>添加至篮子</Button></div><div className="grid gap-2"><Label htmlFor="basket-symbol-search">篮子交易对</Label><Command className="relative overflow-visible border bg-background"><CommandInput id="basket-symbol-search" value={basketPairQuery} onValueChange={updateBasketPairQuery} onFocus={() => setBasketPickerOpen(true)} onBlur={() => window.setTimeout(() => setBasketPickerOpen(false), 120)} placeholder={basketMarket === "okx" ? "搜索 BTC-USDT、BTC 或 USDT" : "搜索 BTCUSDT、BTC 或 USDT"} />{basketPickerOpen && <CommandList className="absolute top-full z-50 mt-1 max-h-52 w-full border bg-popover shadow-md"><CommandEmpty>未找到交易对</CommandEmpty><CommandGroup>{initialData.symbols[basketMarket].map((pair) => <CommandItem key={pair.symbol} value={`${pair.symbol} ${pair.baseAsset} ${pair.quoteAsset}`} onMouseDown={(event) => event.preventDefault()} onSelect={() => { setBasketSymbol(pair.symbol); setBasketPairQuery(pair.symbol); setBasketPickerOpen(false) }}><span>{pair.symbol}</span><span className="ml-auto text-muted-foreground">{pair.baseAsset}/{pair.quoteAsset}</span></CommandItem>)}</CommandGroup></CommandList>}</Command></div><div className="grid gap-2"><Label>篮子成员</Label>{basketMembers.length === 0 ? <p className="border border-dashed p-2 text-xs text-muted-foreground">至少添加一个不同于锚点的交易对。</p> : <div className="flex flex-wrap gap-2">{basketMembers.map((member) => <Badge key={`${member.market}:${member.symbol}`} variant="outline" className="gap-1 py-1"><span>{marketLabel(member.market)} · {member.symbol}</span><button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setBasketMembers((current) => current.filter((item) => item.market !== member.market || item.symbol !== member.symbol))} aria-label={`移除 ${member.symbol}`}>×</button></Badge>)}</div>}</div><div className="grid gap-2"><Label htmlFor="deviation-percent">允许偏移量（%）</Label><Input id="deviation-percent" inputMode="decimal" value={deviationPercent} onChange={(event) => setDeviationPercent(event.target.value)} placeholder="例如：3" /><p className="text-xs text-muted-foreground">任一篮子成员相对锚点价格偏离达到该比例时提醒；回到范围内后才会再次布防。</p></div></div> : condition === "interval" ? <div className="grid gap-3 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="price-interval">粒度</Label><Input id="price-interval" inputMode="decimal" value={interval} onChange={(event) => setInterval(event.target.value)} placeholder="例如：1000" /></div><div className="grid gap-2"><Label htmlFor="interval-reset-range">重置范围</Label><Input id="interval-reset-range" inputMode="decimal" value={intervalResetRange} onChange={(event) => setInterval(event.target.value)} placeholder="例如：200" /></div><p className="text-xs text-muted-foreground sm:col-span-2">触发某一整数倍价位后，价格须离开该价位的上下重置范围，才会再次提醒该价位。</p></div> : <div className="grid gap-2"><Label htmlFor="target-price">目标价格</Label><Input id="target-price" inputMode="decimal" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="例如：100000" /></div>}
            <div className="grid gap-2"><Label>通知渠道（至少选择一个）</Label><div className="grid gap-2 border p-3"><ChannelToggle label="Telegram 推送" channel="telegram" channels={channels} onChange={setChannels} /><ChannelToggle label="FwAlert 电话" channel="phone" channels={channels} onChange={setChannels} /></div></div></>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button><Button onClick={() => void saveRule()} disabled={saving || !symbol || !(condition === "basket" ? basketMembers.length > 0 && deviationPercent : condition === "interval" ? interval && intervalResetRange : targetPrice) || channels.length === 0}>{saving && <LoaderCircle className="animate-spin" />}{editing ? "保存变更" : "创建规则"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-medium">{value}</p></div>
}

function ChannelToggle({ label, channel, channels, onChange }: { label: string; channel: NotificationChannel; channels: NotificationChannel[]; onChange: (channels: NotificationChannel[]) => void }) {
  const checked = channels.includes(channel)
  return <div className="flex items-center justify-between gap-3"><Label>{label}</Label><Switch checked={checked} onCheckedChange={(next) => onChange(next ? [...channels, channel] : channels.filter((item) => item !== channel))} /></div>
}
