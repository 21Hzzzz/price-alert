import * as React from "react"
import { RefreshCw, ShieldCheck } from "lucide-react"

import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table"
import type { PanelAccessLog } from "~/lib/price-alert.types"

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value))
}

function eventLabel(event: PanelAccessLog["event"]) {
  return {
    panel_access: "面板访问",
    login_success: "登录成功",
    login_failure: "登录失败",
    ip_blocked: "封禁拦截",
    logout: "退出登录",
  }[event]
}

function statusClass(status: PanelAccessLog["status"]) {
  return status === "success"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : status === "blocked"
      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
}

export function AccessLogsClient() {
  const [logs, setLogs] = React.useState<PanelAccessLog[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const response = await fetch("/api/access-logs")
      const body = await response.json() as { logs?: PanelAccessLog[]; error?: string }
      if (!response.ok) throw new Error(body.error ?? "无法加载访问日志。")
      setLogs(body.logs ?? [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加载访问日志。")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 20_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  return (
    <main className="flex flex-1 flex-col gap-5 p-4 md:p-6">
      <section className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <p className="text-xs text-muted-foreground">PANEL SECURITY</p>
          <h1 className="mt-1 text-xl font-medium">访问日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">查看最近的面板访问、登录结果和 IP 封禁拦截记录。</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> 刷新</Button>
      </section>

      {error && <p className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="flex size-8 items-center justify-center border bg-muted/30"><ShieldCheck className="size-4" /></div>
          <div>
            <CardTitle>最近事件</CardTitle>
            <CardDescription>保留最近 1,000 条记录；当前显示最近 {logs.length} 条。</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <p className="py-10 text-center text-sm text-muted-foreground">正在加载访问日志…</p> : logs.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">暂时没有访问记录。</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>时间</TableHead><TableHead>IP 地址</TableHead><TableHead>事件</TableHead><TableHead>状态</TableHead><TableHead>路径</TableHead></TableRow></TableHeader>
              <TableBody>{logs.map((log) => <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(log.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{log.ip}</TableCell>
                <TableCell>{eventLabel(log.event)}</TableCell>
                <TableCell><Badge variant="outline" className={statusClass(log.status)}>{log.status === "success" ? "成功" : log.status === "blocked" ? "已拦截" : "失败"}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{log.path}</TableCell>
              </TableRow>)}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
