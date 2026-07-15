import * as React from "react"
import { BrowserQRCodeReader } from "@zxing/browser"
import { LoaderCircle } from "lucide-react"

type QrAddressScannerProps = {
  onScan: (value: string) => boolean
}

function scannerError(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "无法启动摄像头。请确认浏览器已允许摄像头权限。"
}

export function QrAddressScanner({ onScan }: QrAddressScannerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    let stopped = false
    let controls: { stop: () => void } | undefined
    let lastDecodedValue: string | null = null

    async function start() {
      if (!videoRef.current) return
      try {
        const reader = new BrowserQRCodeReader()
        const nextControls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (cancelled || stopped || !result) return
            const value = result.getText()
            if (value === lastDecodedValue) return
            lastDecodedValue = value
            if (onScan(value)) {
              stopped = true
              controls?.stop()
            }
          },
        )
        controls = nextControls
        if (cancelled) controls.stop()
      } catch (scanError) {
        if (!cancelled) setError(scannerError(scanError))
      } finally {
        if (!cancelled) setStarting(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [onScan])

  return (
    <div className="grid gap-3">
      <div className="relative aspect-square overflow-hidden border bg-muted/30">
        <video ref={videoRef} className="size-full object-cover" muted playsInline />
        {starting && <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/85 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在打开摄像头…</div>}
      </div>
      {error ? <p className="border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">将二维码置于取景框内。扫码内容仅在当前浏览器中处理。</p>}
    </div>
  )
}
