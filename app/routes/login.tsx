import * as React from "react"
import { Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Button } from "~/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group"
import { Label } from "~/components/ui/label"

export default function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = React.useState("")
  const [passwordVisible, setPasswordVisible] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    void fetch("/api/auth/session")
      .then((response) => response.json() as Promise<{ authenticated: boolean }>)
      .then((session) => {
        if (session.authenticated) navigate("/price-monitoring", { replace: true })
      })
  }, [navigate])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error ?? "登录失败。")
      navigate("/price-monitoring", { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登录失败。")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center bg-primary text-primary-foreground"><KeyRound className="size-4" /></div>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>请输入面板密码以继续。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="panel-password">面板密码</Label>
              <InputGroup>
                <InputGroupInput
                  id="panel-password"
                  type={passwordVisible ? "text" : "password"}
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                    title={passwordVisible ? "隐藏密码" : "显示密码"}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <Button type="submit" disabled={submitting || password.length === 0}>
              {submitting && <LoaderCircle className="animate-spin" />} 登录
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
