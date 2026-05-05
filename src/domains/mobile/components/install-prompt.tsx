import { useState } from "react"

import { usePwaInstall } from "@/common/hooks/use-pwa-install"

const DISMISS_KEY = "codex.install-dismissed"

export function InstallPrompt() {
  const { canInstall, platform, promptInstall } = usePwaInstall()
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.localStorage.getItem(DISMISS_KEY) === "1",
  )

  if (!canInstall || dismissed) return null

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  if (platform === "android-chrome") {
    return (
      <div className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white shadow-lg backdrop-blur">
        <span>홈 화면에 Codex Mobile 설치하기</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black"
            onClick={() => void promptInstall()}
          >
            설치
          </button>
          <button
            type="button"
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80"
            onClick={dismiss}
          >
            닫기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">앱처럼 쓰려면 홈 화면에 추가</span>
        <button
          type="button"
          className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80"
          onClick={dismiss}
        >
          닫기
        </button>
      </div>
      <div className="text-xs text-white/70">
        Safari 하단 <span aria-label="공유">⬆︎</span> 공유 → "홈 화면에 추가"
      </div>
    </div>
  )
}
