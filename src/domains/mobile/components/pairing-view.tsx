import { useState, type FormEvent } from "react"
import { Loader2, Plug, QrCode, RefreshCw, Smartphone } from "lucide-react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { Button } from "@/common/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/common/ui/card"
import { Input } from "@/common/ui/input"

function formatLoginStatus(status?: string) {
  if (status === "running") return "OpenAI 로그인 진행 중"
  if (status === "completed" || status === "already_logged_in") return "로그인 완료"
  if (status === "cancelled") return "로그인 취소됨"
  if (status === "failed") return "로그인 실패"
  return "OpenAI 로그인 필요"
}

const PAIR_CODE_RE = /^[0-9A-F]{8}$/

function ManualPairForm() {
  const [value, setValue] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const code = value.trim().toUpperCase()
  const valid = PAIR_CODE_RE.test(code)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || submitting) return
    setSubmitting(true)
    try {
      await mobileController.completePair(code)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="text-xs text-muted-foreground">
        데스크톱 페어링 화면에 표시된 8자리 코드를 입력하세요.
      </div>
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\s+/g, "").toUpperCase().slice(0, 8))}
        placeholder="ABCD1234"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="one-time-code"
        spellCheck={false}
        inputMode="text"
        maxLength={8}
        className="h-10 rounded-md border border-border bg-[var(--canvas-soft)] px-3 text-center text-base font-semibold tracking-[0.4em]"
      />
      <Button type="submit" disabled={!valid || submitting} className="w-full gap-2">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
        연결
      </Button>
    </form>
  )
}

export function PairingView({ state }: { state: Record<string, any> }) {
  const codexOk = Boolean(state.desktopStatus?.codex?.installed)
  const loginOk = Boolean(state.desktopStatus?.login?.loggedIn)
  const ready = codexOk && loginOk
  const loginFlow = state.loginFlow
  // QR/Pair-code generation requires a loopback request, so on a remote
  // browser (e.g. Tailscale Funnel from a phone) `state.pairing` is null and
  // `pairingError` carries the 403. Either way, surface the manual code entry.
  const remotePairingOnly = ready && !state.pairing

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-background text-foreground">
      <div
        className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-5 px-4"
        style={{
          paddingTop: "max(1.5rem, env(safe-area-inset-top))",
          paddingBottom:
            "max(1.5rem, env(safe-area-max-inset-bottom, env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card">
            <Smartphone className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Codex Mobile</h1>
          <p className="text-sm text-muted-foreground">데스크톱 Codex 세션을 모바일에서 빠르게 이어서 작업할 수 있게 연결합니다.</p>
        </div>

        <Card className="border-border bg-card shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {loginFlow?.running ? <Loader2 className="size-4 animate-spin text-primary" /> : <QrCode className="size-4 text-primary" />}
              Desktop status
            </CardTitle>
            <CardDescription>
              {!state.desktopStatus && !state.desktopStatusError ? "로컬 Codex 환경과 로그인 상태를 확인 중입니다." : "모바일 연결 전에 데스크톱 준비 상태를 확인합니다."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 rounded-xl border border-border bg-[var(--canvas-soft)] p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Codex CLI</span>
                <span className={codexOk ? "text-emerald-400" : "text-amber-300"}>{codexOk ? "Ready" : "Need install"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">OpenAI login</span>
                <span className={loginOk ? "text-emerald-400" : "text-amber-300"}>{loginOk ? "Connected" : formatLoginStatus(loginFlow?.status)}</span>
              </div>
            </div>

            {state.desktopStatusError ? <p className="text-sm text-destructive">{state.desktopStatusError}</p> : null}

            {!ready ? (
              <div className="flex flex-col gap-2">
                {!codexOk ? (
                  <Button onClick={() => void mobileController.loadDesktopStatus()} className="w-full gap-2">
                    <RefreshCw className="size-4" /> 다시 확인
                  </Button>
                ) : loginFlow?.running ? (
                  <Button variant="secondary" onClick={() => void mobileController.cancelDesktopLogin()} className="w-full">
                    로그인 취소
                  </Button>
                ) : (
                  <Button onClick={() => void mobileController.startDesktopLogin()} className="w-full">
                    OpenAI 로그인
                  </Button>
                )}
              </div>
            ) : remotePairingOnly ? (
              <div className="space-y-3">
                <ManualPairForm />
                {state.pairingError ? (
                  <p className="text-sm text-destructive">{state.pairingError}</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-2xl border border-border bg-white p-3" dangerouslySetInnerHTML={{ __html: state.pairing?.qrSvg || "" }} />
                <div className="rounded-xl border border-border bg-[var(--canvas-soft)] p-3 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">Pair code</div>
                  <div className="mt-1 text-base font-semibold tracking-[0.2em] text-primary">{state.pairing?.code || "----"}</div>
                  {state.pairing?.qrUrl ? <p className="mt-2 break-all text-xs">{state.pairing.qrUrl}</p> : null}
                </div>
                <Button variant="secondary" onClick={() => void mobileController.showPairingQr()} className="w-full gap-2">
                  <RefreshCw className="size-4" /> QR 새로고침
                </Button>
                <div className="border-t border-[var(--hairline-soft)] pt-3">
                  <ManualPairForm />
                </div>
                {state.pairingError ? (
                  <p className="text-sm text-destructive">{state.pairingError}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
