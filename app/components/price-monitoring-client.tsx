import * as React from "react"
import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Pencil,
  PhoneCall,
  Plus,
  Send,
  Trash2,
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
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
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
  BinanceSymbol,
  FwAlertSettingsStatus,
  MarketSnapshot,
  NotificationChannel,
  TelegramSettingsStatus,
} from "~/lib/price-alert.types"

type PageData = {
  symbols: BinanceSymbol[]
  rules: AlertRule[]
  telegram: TelegramSettingsStatus
  fwalert: FwAlertSettingsStatus
}

type AlertCondition = AlertDirection | "interval"

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

export function PriceMonitoringClient() {
  const [initialData, setInitialData] = React.useState<PageData>({
    symbols: [],
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
  const [symbol, setSymbol] = React.useState("")
  const [direction, setDirection] = React.useState<AlertDirection>("above")
  const [targetPrice, setTargetPrice] = React.useState("")
  const [interval, setInterval] = React.useState("")
  const [condition, setCondition] = React.useState<AlertCondition>("above")
  const [channels, setChannels] = React.useState<NotificationChannel[]>(["telegram"])
  const [pairPickerOpen, setPairPickerOpen] = React.useState(false)

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
    setSymbol("")
    setDirection("above")
    setTargetPrice("")
    setInterval("")
    setCondition("above")
    setChannels(["telegram"])
    setDialogOpen(true)
  }

  function openEdit(rule: AlertRule) {
    setEditing(rule)
    setSymbol(rule.symbol)
    setDirection(rule.direction)
    setTargetPrice(rule.targetPrice)
    setInterval(rule.interval ?? "")
    setCondition(rule.triggerType === "interval" ? "interval" : rule.direction)
    setChannels(rule.channels)
    setDialogOpen(true)
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
          triggerType: condition === "interval" ? "interval" : "target",
          direction: condition === "interval" ? "above" : condition,
          targetPrice: condition === "interval" ? undefined : targetPrice,
          interval: condition === "interval" ? interval : undefined,
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
          symbol: values.symbol,
          triggerType: values.triggerType,
          direction: values.direction,
          targetPrice: values.targetPrice,
          interval: values.interval,
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

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <section className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs text-muted-foreground">BINANCE SPOT · 5 秒刷新</p>
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
          <CardHeader>
            <CardTitle>Telegram 推送渠道</CardTitle>
            <CardDescription>使用 Bot Token 和 Chat ID 接收价格穿越提醒。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!telegram.encryptionReady && (
              <p className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">服务端缺少 PRICE_ALERT_ENCRYPTION_KEY，暂不能保存 Token。</p>
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
              <Badge variant={telegram.configured ? "secondary" : "outline"}>{telegram.configured ? "已配置" : "未配置"}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>FwAlert 电话渠道</CardTitle>
            <CardDescription>保存平台提供的电话推送链接；每次调用由平台决定是否触发电话。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!fwalert.encryptionReady && (
              <p className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">服务端缺少 PRICE_ALERT_ENCRYPTION_KEY，暂不能保存电话链接。</p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="fwalert-url">电话推送链接</Label>
              <Input id="fwalert-url" type="url" value={fwalertUrl} onChange={(event) => setFwalertUrl(event.target.value)} placeholder="https://fwalert.com/..." autoComplete="off" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveFwalert()} disabled={saving || !fwalert.encryptionReady}><Check /> 保存配置</Button>
              <Button variant="outline" onClick={() => void testFwalert()} disabled={saving || !fwalert.configured}><PhoneCall /> 电话测试</Button>
              <Badge variant={fwalert.configured ? "secondary" : "outline"}>{fwalert.configured ? "已配置" : "未配置"}</Badge>
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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>监控规则</CardTitle>
            <CardDescription>仅在价格实际穿越目标价时发送一次提醒。</CardDescription>
          </div>
          <Badge variant="outline">{rules.filter((rule) => rule.enabled).length} active</Badge>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed text-center">
              <p className="text-sm">尚未创建监控规则</p>
              <Button variant="outline" onClick={openCreate}><Plus /> 添加第一条规则</Button>
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>交易对</TableHead><TableHead>最新价</TableHead><TableHead>条件</TableHead><TableHead>目标价</TableHead><TableHead>通知渠道</TableHead><TableHead>状态</TableHead><TableHead>最后触发</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
              <TableBody>{rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.symbol}</TableCell>
                  <TableCell>{formatPrice(rule.lastPrice)}</TableCell>
                  <TableCell><Badge variant={rule.triggerType === "interval" || rule.direction === "above" ? "secondary" : "outline"}>{rule.triggerType === "interval" ? "整数倍价位" : rule.direction === "above" ? "上穿" : "下穿"}</Badge></TableCell>
                  <TableCell>{rule.triggerType === "interval" ? `每 ${formatPrice(rule.interval ?? rule.targetPrice)}` : formatPrice(rule.targetPrice)}</TableCell>
                  <TableCell><div className="flex gap-1">{rule.channels.map((channel) => <Badge key={channel} variant="outline">{channel === "telegram" ? "Telegram" : "电话"}</Badge>)}</div></TableCell>
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
            <div className="grid gap-2"><Label>Binance 现货交易对</Label><Popover open={pairPickerOpen} onOpenChange={setPairPickerOpen}><PopoverTrigger render={<Button variant="outline" className="w-full justify-between font-normal" />}>{symbol ? symbol : "搜索并选择交易对"}<ChevronDown /></PopoverTrigger><PopoverContent align="start" className="w-[var(--anchor-width)] p-0"><Command><CommandInput placeholder="搜索 BTCUSDT、BTC 或 USDT" /><CommandList><CommandEmpty>未找到交易对</CommandEmpty><CommandGroup>{initialData.symbols.map((pair) => <CommandItem key={pair.symbol} value={`${pair.symbol} ${pair.baseAsset} ${pair.quoteAsset}`} onSelect={() => { setSymbol(pair.symbol); setPairPickerOpen(false) }}><span>{pair.symbol}</span><span className="ml-auto text-muted-foreground">{pair.baseAsset}/{pair.quoteAsset}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover></div>
            <div className="grid gap-2"><Label>触发条件</Label><Select value={condition} onValueChange={(value) => setCondition(value as AlertCondition)}><SelectTrigger className="w-full"><SelectValue>{(value: AlertCondition | null) => value === "above" ? "上穿目标价" : value === "below" ? "下穿目标价" : value === "interval" ? "整数倍价位" : "选择触发条件"}</SelectValue></SelectTrigger><SelectContent><SelectItem value="above">上穿目标价</SelectItem><SelectItem value="below">下穿目标价</SelectItem><SelectItem value="interval">整数倍价位</SelectItem></SelectContent></Select></div>
            {condition === "interval" ? <div className="grid gap-2"><Label htmlFor="price-interval">粒度</Label><Input id="price-interval" inputMode="decimal" value={interval} onChange={(event) => setInterval(event.target.value)} placeholder="例如：1000" /><p className="text-xs text-muted-foreground">价格跨过粒度的整数倍时提醒，例如 BTCUSDT 每 1000 提醒一次。</p></div> : <div className="grid gap-2"><Label htmlFor="target-price">目标价格</Label><Input id="target-price" inputMode="decimal" value={targetPrice} onChange={(event) => setTargetPrice(event.target.value)} placeholder="例如：100000" /></div>}
            <div className="grid gap-2"><Label>通知渠道（至少选择一个）</Label><div className="grid gap-2 border p-3"><ChannelToggle label="Telegram 推送" channel="telegram" channels={channels} onChange={setChannels} /><ChannelToggle label="FwAlert 电话" channel="phone" channels={channels} onChange={setChannels} /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button><Button onClick={() => void saveRule()} disabled={saving || !symbol || !(condition === "interval" ? interval : targetPrice) || channels.length === 0}>{saving && <LoaderCircle className="animate-spin" />}{editing ? "保存变更" : "创建规则"}</Button></DialogFooter>
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
