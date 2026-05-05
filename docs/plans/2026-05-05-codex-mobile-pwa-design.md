# Codex Mobile PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the codex-mobile web client installable as a PWA on iOS Safari and Android Chrome, with offline shell caching, while keeping the existing per-session pairing flow intact.

**Architecture:** Add a Web App Manifest, a service worker (built via `vite-plugin-pwa` / Workbox), iOS-specific HTML meta tags, and an in-app install hint that activates only on "stable" origins (i.e. not on temporary `*.trycloudflare.com` tunnels). The bridge HTTP server already serves files from `dist/` so the generated manifest and SW need no extra routing — only correct content-type + cache headers, plus a guard to avoid the SPA index.html fallback swallowing `/sw.js` and `/manifest.webmanifest`.

**Tech Stack:** Vite 8, React 19, TypeScript, `vite-plugin-pwa` (Workbox under the hood), `sharp` (icon generation), Node bridge (`src/bridge/server.js`).

**Stable URL strategy:** Out of code scope — user is expected to expose the bridge via a stable origin (recommended: Tailscale Funnel — free, no domain, permanent `<device>.<tailnet>.ts.net`). README will document the setup.

**Out of scope (deferred):**
- Long-lived device tokens / persistent pairing (separate PR).
- Web Push for closed-app notifications.
- Background sync.

---

## File Layout (after this plan)

```
codex-mobile/
├── index.html                              # add iOS meta tags + manifest link
├── package.json                            # add vite-plugin-pwa, sharp (devDep)
├── vite.config.ts                          # configure VitePWA plugin
├── public/
│   ├── icon.svg                            # already present
│   ├── icon-192.png                        # NEW (generated)
│   ├── icon-512.png                        # NEW (generated)
│   ├── icon-maskable-512.png               # NEW (generated, with safe area padding)
│   └── apple-touch-icon.png                # NEW (180x180, generated)
├── scripts/
│   └── generate-pwa-icons.mjs              # NEW (sharp-based one-shot script)
├── src/
│   ├── client/
│   │   └── main.tsx                        # register SW with auto-update
│   ├── common/hooks/
│   │   └── use-pwa-install.ts              # NEW
│   ├── domains/mobile/components/
│   │   └── install-prompt.tsx              # NEW
│   └── app/App.tsx                         # mount <InstallPrompt/>
├── src/bridge/
│   └── server.js                           # add manifest+sw mime types, fix SPA fallback guard
└── docs/
    └── plans/2026-05-05-codex-mobile-pwa-design.md  # this file
```

---

## Key Design Decisions

### 1. Why `vite-plugin-pwa` over a hand-rolled service worker

Workbox-backed precaching auto-tracks every emitted asset hash. A hand-rolled SW would have a stale precache list within one build cycle. Plugin is mature (v1.x, 2025+), supports Vite 7/8, registered with `registerType: "autoUpdate"` so users always get the latest shell after each desktop companion build. **Fallback if Vite 8 incompatibility:** revert to a hand-rolled `public/sw.js` + static `public/manifest.webmanifest` (manual asset list, less ideal).

### 2. Caching strategy

| Path pattern | Strategy | Rationale |
|---|---|---|
| Hashed JS/CSS/img assets in `/assets/*` | Precache + cache-first | Immutable hashed files. Offline shell loads instantly. |
| `/icon-*.png`, `/apple-touch-icon.png` | Precache | Icons rarely change. |
| `/api/**` | NetworkOnly (no cache) | Live data; stale responses would mislead. |
| `/api/events` (WebSocket upgrade) | Bypass SW entirely | SW must not intercept WS. |
| `/uploads/*` (session files) | NetworkOnly | Per-session, would leak across origins. |
| Navigations (`/`, `/?token=...`) | NetworkFirst with offline fallback to cached `index.html` | Fresh shell when online, instant offline shell otherwise. |

The Workbox config uses `navigateFallbackDenylist: [/^\/api\//, /^\/sw\.js/, /^\/manifest\.webmanifest/]` so SPA fallback never wraps API or SW assets.

### 3. Install gate: when does the install button show?

Goal: do not lock users into a temporary `*.trycloudflare.com` URL by installing the PWA there.

`use-pwa-install.ts` exposes `{ canInstall, platform, promptInstall }`:
- `platform`: one of `"android-chrome" | "ios-safari" | "desktop" | "other"` (UA-based detection — pragmatic, not perfect)
- `canInstall`:
  - `true` if `beforeinstallprompt` fired (Android Chrome path) **AND** origin passes stable-origin check
  - `true` if iOS Safari **AND** origin passes stable-origin check **AND** not already in standalone mode (`window.matchMedia('(display-mode: standalone)').matches === false`)
  - `false` otherwise
- Stable-origin check rejects hostnames matching: `*.trycloudflare.com`, `*.ngrok.app`, `*.ngrok-free.app`, `*.loca.lt`, `localhost`, `127.0.0.1`. Everything else (LAN IPs, `*.ts.net` Tailscale, custom domains) treated as stable.

`<InstallPrompt/>` renders nothing if `canInstall === false`. On Android, it renders a button that calls `promptInstall()`. On iOS, it renders a hint card with a "공유 → 홈 화면에 추가" instruction (since iOS has no programmatic install).

### 4. iOS Safari requirements (compatibility-critical)

iOS Safari doesn't read `manifest.webmanifest` for everything. We must also set:
- `<meta name="apple-mobile-web-app-capable" content="yes">` (deprecated alias still respected)
- `<meta name="mobile-web-app-capable" content="yes">` (modern alias)
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `<meta name="apple-mobile-web-app-title" content="Codex">`
- `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`
- `<meta name="theme-color" content="#151513">` (already present)
- `<meta name="viewport" content="..., viewport-fit=cover">` (already present — keep)

### 5. Service worker registration timing

Register in `src/client/main.tsx` after `createRoot` mounts, using `vite-plugin-pwa`'s virtual module:

```ts
import { registerSW } from "virtual:pwa-register"
registerSW({ immediate: true })
```

`immediate: true` because we use `registerType: "autoUpdate"`. No update toast shown — the next launch picks up the new SW silently. Trade-off: simpler UX vs. "update available" dialog. Given this is a developer tool with frequent rebuilds, silent auto-update is right.

### 6. Bridge server tweaks

Currently `src/bridge/server.js:1107` falls back to `index.html` for any 404. This must NOT happen for `/sw.js`, `/manifest.webmanifest`, and `/registerSW.js`, otherwise the browser receives HTML where it expects JS/JSON and registration fails silently.

Add early return in the catch branch when `pathname` matches PWA file patterns. Also extend `contentType()` to map `.webmanifest` → `application/manifest+json`.

Cache headers:
- `index.html`: `cache-control: no-cache` (so users always fetch fresh shell when online)
- Hashed `/assets/*`: `cache-control: public, max-age=31536000, immutable`
- `/sw.js`: `cache-control: no-cache, no-store, must-revalidate` (browsers MUST re-check SW each time)
- `/manifest.webmanifest`: `cache-control: public, max-age=3600`

---

## Implementation Tasks

Each task is one logical unit. Commit after each.

### Task 1: Add devDependencies

**Files:**
- Modify: `codex-mobile/package.json`

**Step 1: Install plugin + icon generator**

```bash
cd codex-mobile
npm install --save-dev vite-plugin-pwa workbox-window sharp
```

**Step 2: Verify Vite 8 compatibility**

Run: `npm run build`
Expected: Builds successfully, no peer dep warnings about Vite version.

**Fallback:** If `vite-plugin-pwa` errors on Vite 8, install `vite-plugin-pwa@latest`. If still incompatible, switch plan to hand-rolled SW (note in PR description).

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(codex-mobile): add vite-plugin-pwa and sharp for PWA"
```

---

### Task 2: Icon generation script

**Files:**
- Create: `codex-mobile/scripts/generate-pwa-icons.mjs`
- Modify: `codex-mobile/package.json` (add `"icons": "node scripts/generate-pwa-icons.mjs"` script)

**Step 1: Write the script**

```js
// codex-mobile/scripts/generate-pwa-icons.mjs
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const svgPath = path.join(root, "public", "icon.svg")
const publicDir = path.join(root, "public")

const targets = [
  { name: "icon-192.png", size: 192, padding: 0 },
  { name: "icon-512.png", size: 512, padding: 0 },
  // Maskable: 20% safe-area padding around the symbol so launchers can crop.
  { name: "icon-maskable-512.png", size: 512, padding: 0.2 },
  { name: "apple-touch-icon.png", size: 180, padding: 0 },
]

const svg = await readFile(svgPath)

for (const { name, size, padding } of targets) {
  const inner = Math.round(size * (1 - padding * 2))
  const offset = Math.round((size - inner) / 2)
  const composite = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: { r: 21, g: 21, b: 19, alpha: 1 } })
    .png()
    .toBuffer()
  await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 21, g: 21, b: 19, alpha: 1 } },
  })
    .composite([{ input: composite, top: offset, left: offset }])
    .png()
    .toFile(path.join(publicDir, name))
  console.log(`✓ ${name} (${size}×${size})`)
}
```

**Step 2: Run it**

```bash
cd codex-mobile
node scripts/generate-pwa-icons.mjs
```

Expected output:
```
✓ icon-192.png (192×192)
✓ icon-512.png (512×512)
✓ icon-maskable-512.png (512×512)
✓ apple-touch-icon.png (180×180)
```

**Step 3: Verify**

```bash
ls -la codex-mobile/public/*.png
```

Expected: 4 PNG files, each 1–10 KB.

**Step 4: Add npm script**

In `codex-mobile/package.json` under `scripts`:
```json
"icons": "node scripts/generate-pwa-icons.mjs"
```

**Step 5: Commit**

```bash
git add scripts/generate-pwa-icons.mjs public/icon-192.png public/icon-512.png public/icon-maskable-512.png public/apple-touch-icon.png package.json
git commit -m "feat(codex-mobile): add PWA icon generation script and icons"
```

---

### Task 3: Configure VitePWA plugin

**Files:**
- Modify: `codex-mobile/vite.config.ts`

**Step 1: Replace contents**

```ts
import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false, // we register manually in main.tsx
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Codex Mobile",
        short_name: "Codex",
        description: "Mobile companion for the local Codex session bridge.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#151513",
        theme_color: "#151513",
        lang: "ko",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/sw\.js$/, /^\/manifest\.webmanifest$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/uploads/"),
            handler: "NetworkOnly",
          },
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: false, // SW disabled in dev to avoid stale-cache pain
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
```

**Step 2: Build and verify generated artifacts**

```bash
cd codex-mobile
npm run build
ls dist/
```

Expected files in `dist/`:
- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `workbox-*.js`
- `assets/`
- `icon-*.png`, `apple-touch-icon.png`, `icon.svg`

**Step 3: Sanity-check manifest**

```bash
cat codex-mobile/dist/manifest.webmanifest | python3 -m json.tool
```

Expected: valid JSON with `name`, `icons`, `display: "standalone"`.

**Step 4: Commit**

```bash
git add vite.config.ts
git commit -m "feat(codex-mobile): configure vite-plugin-pwa with workbox caching"
```

---

### Task 4: iOS-specific meta tags + manifest link

**Files:**
- Modify: `codex-mobile/index.html`

**Step 1: Update head**

Replace the existing `<head>` with:

```html
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#151513" />
  <meta name="color-scheme" content="dark" />

  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Codex" />

  <title>Codex Mobile</title>
</head>
```

**Step 2: Build + inspect**

```bash
cd codex-mobile
npm run build
grep -E "manifest|apple-touch|web-app" dist/index.html
```

Expected: all the meta/link tags present.

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat(codex-mobile): add PWA manifest link and iOS meta tags"
```

---

### Task 5: Register the service worker

**Files:**
- Modify: `codex-mobile/src/client/main.tsx`

**Step 1: Update**

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { registerSW } from "virtual:pwa-register"

import App from "@/app/App"
import "./index.css"

registerSW({ immediate: true })

createRoot(document.querySelector("#app") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 2: Add type reference for `virtual:pwa-register`**

Modify: `codex-mobile/src/client/vite-env.d.ts` (or create if missing). Add:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

**Step 3: Typecheck**

```bash
cd codex-mobile
npm run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/client/main.tsx src/client/vite-env.d.ts
git commit -m "feat(codex-mobile): register service worker with auto-update"
```

---

### Task 6: `usePwaInstall` hook

**Files:**
- Create: `codex-mobile/src/common/hooks/use-pwa-install.ts`

**Step 1: Write hook**

```ts
import { useEffect, useState } from "react"

type Platform = "android-chrome" | "ios-safari" | "desktop" | "other"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const TEMPORARY_HOSTNAMES = [
  /\.trycloudflare\.com$/i,
  /\.ngrok\.app$/i,
  /\.ngrok-free\.app$/i,
  /\.loca\.lt$/i,
]

function isStableOrigin(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1") return false
  return !TEMPORARY_HOSTNAMES.some((pattern) => pattern.test(hostname))
}

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other"
  const ua = navigator.userAgent
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window)
  const isAndroid = /Android/.test(ua)
  if (isIOS) return "ios-safari"
  if (isAndroid) return "android-chrome"
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop"
  return "other"
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true
  // iOS Safari legacy
  return Boolean((navigator as unknown as { standalone?: boolean }).standalone)
}

export function usePwaInstall() {
  const [platform] = useState<Platform>(() => detectPlatform())
  const [stableOrigin] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isStableOrigin(window.location.hostname),
  )
  const [standalone, setStandalone] = useState<boolean>(() => isStandalone())
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", handler)
    const installed = () => {
      setStandalone(true)
      setInstallEvent(null)
    }
    window.addEventListener("appinstalled", installed)
    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.removeEventListener("appinstalled", installed)
    }
  }, [])

  const canInstall =
    !standalone &&
    stableOrigin &&
    (platform === "android-chrome" ? installEvent !== null : platform === "ios-safari")

  async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!installEvent) return "unavailable"
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    return choice.outcome
  }

  return { canInstall, platform, stableOrigin, standalone, promptInstall }
}
```

**Step 2: Typecheck**

```bash
cd codex-mobile
npm run typecheck
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/common/hooks/use-pwa-install.ts
git commit -m "feat(codex-mobile): add usePwaInstall hook with stable-origin gate"
```

---

### Task 7: `<InstallPrompt/>` component

**Files:**
- Create: `codex-mobile/src/domains/mobile/components/install-prompt.tsx`
- Modify: `codex-mobile/src/app/App.tsx`

**Step 1: Component**

```tsx
import { useState } from "react"

import { usePwaInstall } from "@/common/hooks/use-pwa-install"

export function InstallPrompt() {
  const { canInstall, platform, promptInstall } = usePwaInstall()
  const [dismissed, setDismissed] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.localStorage.getItem("codex.install-dismissed") === "1",
  )

  if (!canInstall || dismissed) return null

  const dismiss = () => {
    window.localStorage.setItem("codex.install-dismissed", "1")
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

  // iOS Safari hint
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
```

**Step 2: Mount in App**

Modify `src/app/App.tsx`:

```tsx
import { useEffect } from "react"

import { mobileController } from "@/domains/mobile/runtime/controller"
import { useMobileRuntime } from "@/common/hooks/use-mobile-runtime"
import { TooltipProvider } from "@/common/ui/tooltip"
import { PairingView } from "@/domains/mobile/components/pairing-view"
import { SettingsPane } from "@/domains/mobile/components/settings-pane"
import { WorkspaceShell } from "@/domains/mobile/components/workspace-shell"
import { InstallPrompt } from "@/domains/mobile/components/install-prompt"

export default function App() {
  const state = useMobileRuntime()

  useEffect(() => {
    void mobileController.init()
  }, [])

  if (!state.token) {
    return (
      <>
        <PairingView state={state} />
        <InstallPrompt />
      </>
    )
  }

  return (
    <TooltipProvider>
      {state.screen === "settings" ? <SettingsPane state={state} /> : <WorkspaceShell state={state} />}
      <InstallPrompt />
    </TooltipProvider>
  )
}
```

**Step 3: Typecheck + build**

```bash
cd codex-mobile
npm run typecheck && npm run build
```

Expected: builds clean.

**Step 4: Commit**

```bash
git add src/domains/mobile/components/install-prompt.tsx src/app/App.tsx
git commit -m "feat(codex-mobile): add install prompt component for Android and iOS"
```

---

### Task 8: Bridge MIME types + SPA fallback guard

**Files:**
- Modify: `codex-mobile/src/bridge/server.js` (around lines 1092-1132)

**Step 1: Extend `contentType()`**

Add before the final `return`:
```js
if (lower.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
```

**Step 2: Guard SPA fallback**

Replace the `serveStatic` function:

```js
const PWA_FILES = new Set(["/sw.js", "/manifest.webmanifest", "/registerSW.js", "/workbox-config.js"]);

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const staticDir = await directoryExists(distDir) ? distDir : publicDir;
  const target = path.normalize(path.join(staticDir, pathname));
  if (!target.startsWith(staticDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "content-type": contentType(target),
      ...cacheHeadersFor(pathname),
    });
    res.end(data);
  } catch {
    // Do NOT fall back to index.html for PWA files or workbox chunks.
    if (PWA_FILES.has(pathname) || /^\/workbox-[\w-]+\.js$/.test(pathname)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }
    const data = await fs.readFile(path.join(staticDir, "index.html"));
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(data);
  }
}

function cacheHeadersFor(pathname) {
  if (pathname === "/index.html") return { "cache-control": "no-cache" };
  if (pathname === "/sw.js") return { "cache-control": "no-cache, no-store, must-revalidate" };
  if (pathname === "/manifest.webmanifest") return { "cache-control": "public, max-age=3600" };
  if (pathname.startsWith("/assets/")) return { "cache-control": "public, max-age=31536000, immutable" };
  return {};
}
```

**Step 3: Smoke test**

```bash
cd codex-mobile
npm run build
node src/bridge/server.js &
sleep 2
curl -sI http://127.0.0.1:8787/manifest.webmanifest | head -5
curl -sI http://127.0.0.1:8787/sw.js | head -5
curl -sI http://127.0.0.1:8787/index.html | head -5
kill %1
```

Expected:
- manifest: `content-type: application/manifest+json; charset=utf-8`, `cache-control: public, max-age=3600`
- sw.js: `content-type: text/javascript; charset=utf-8`, `cache-control: no-cache, no-store, must-revalidate`
- index.html: `cache-control: no-cache`

**Step 4: Commit**

```bash
git add src/bridge/server.js
git commit -m "feat(codex-mobile): add PWA mime type and SPA fallback guard for sw/manifest"
```

---

### Task 9: README — Tailscale Funnel setup guide

**Files:**
- Modify: `codex-mobile/README.md`

**Step 1: Update the "Web-Only Reality" section**

Replace lines 131-135 (the "Web-Only Reality" section) with:

```md
## Stable URL for "install once" PWA (optional)

By default, `npm start` creates a temporary `*.trycloudflare.com` tunnel that
rotates per session — fine for QR pairing, not fine for installing the app to
your phone home screen.

If you want a permanent URL so the PWA installs once and survives desktop
restarts, expose the bridge through a stable origin and pass it via
`PUBLIC_URL`. Recommended setup (free, no domain required):

### Tailscale Funnel

One-time setup on the desktop:

1. Install Tailscale and sign in with any account (Google/GitHub/etc).
2. Enable Funnel on this machine:

   ```sh
   sudo tailscale funnel --bg 8787
   ```

3. Note the URL Tailscale prints, e.g. `https://my-mac.tail-xxxx.ts.net`.
4. Add it to your shell profile so `npm start` picks it up:

   ```sh
   export PUBLIC_URL=https://my-mac.tail-xxxx.ts.net
   ```

Then `npm start` will skip the temporary tunnel and the QR will point at your
permanent URL. Open it on your phone, complete pairing, then "Add to Home
Screen" (iOS) or "Install app" (Android). The icon survives desktop restarts;
only re-pairing of the per-session token happens on next launch.

### Notes

- Tailscale Funnel is free on the Personal plan (April 2026 update: 6 users,
  unlimited devices).
- The pairing token is still per-session; this only fixes the URL, not the
  token. A future change may add long-lived device tokens.
- Tailscale Funnel exposes the URL publicly. Pairing-token verification is
  still the gate, identical to the current tunnel mode.

## Notification scope

Closed-app push notifications remain out of scope: this project only delivers
notifications while the paired mobile browser/PWA is connected during the
current desktop session.
```

**Step 2: Update the Status section**

In the "Implemented" list (around line 120), replace:

```md
- Web-only mobile experience opened from the pairing QR; install prompts are intentionally not shown.
```

with:

```md
- Installable PWA (manifest, service worker, iOS-compatible meta tags). Install prompt is suppressed on temporary tunnel origins; visible on Tailscale Funnel / LAN / custom domains.
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs(codex-mobile): add Tailscale Funnel setup guide for stable PWA URL"
```

---

### Task 10: Manual verification on real devices

This is a checklist, not a code task. Execute and document results in the PR description.

**Build + serve:**

```bash
cd codex-mobile
npm run build
PUBLIC_URL=http://<your-LAN-IP>:8787 HOST=0.0.0.0 npm run serve
```

(LAN test is enough for the PWA install path — Tailscale Funnel is just one stable origin among many.)

**Android Chrome:**

1. Open `http://<LAN-IP>:8787` in Chrome on Android.
2. Open DevTools via desktop USB debug → Application → Manifest. Verify name, icons, theme color.
3. DevTools → Application → Service Workers. Verify `sw.js` registered, status: activated.
4. Tap browser menu → "Install app" should appear. Or our in-app prompt button.
5. Confirm install → app icon appears on home screen.
6. Launch from home screen → opens in standalone (no Chrome address bar).
7. Airplane mode → relaunch → shell renders with cached UI; pairing screen shows "연결 안 됨" gracefully (verify error UX is acceptable).

**iOS Safari (iPhone):**

1. Open `http://<LAN-IP>:8787` in Safari (note: iOS Safari requires HTTPS for full PWA support; for full test use Tailscale Funnel HTTPS URL).
2. Tap Share → "홈 화면에 추가" → confirm.
3. Launch from home screen → opens in standalone (no Safari chrome).
4. Verify status bar matches `apple-mobile-web-app-status-bar-style`.
5. Verify the in-app install hint is hidden (because already standalone).

**On `*.trycloudflare.com`:**

1. Run `npm start` (default temporary tunnel mode).
2. Open the QR'd URL on phone.
3. Verify the install prompt does NOT show (because hostname matches the temporary blocklist).

**Lighthouse audit (optional):**

```bash
npx lighthouse https://<your-stable-origin> --only-categories=pwa --output=html --output-path=./pwa-audit.html
```

Expected: PWA score ≥ 90; "Installable" criteria all green.

---

## Risk Register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `vite-plugin-pwa` doesn't yet support Vite 8 | Med | Fallback to hand-rolled SW + manifest (see Decision #1). Verify in Task 1 before proceeding. |
| Service worker caches the WS upgrade endpoint | Low | `navigateFallbackDenylist` includes `/api/`; SW does not intercept `Connection: Upgrade`. |
| iOS doesn't fire `beforeinstallprompt` | Expected | iOS branch shows manual hint; no programmatic install. |
| User installs at `*.trycloudflare.com` URL anyway via "Add to Home Screen" (Safari ignores our gate) | Low | Documented in README; URL becomes dead next session, user removes icon. Acceptable since it's a temporary tunnel. |
| Stale SW after redeploy | Low | `clientsClaim: true`, `skipWaiting: true`, `cleanupOutdatedCaches: true`. New SW activates on next page load. |
| Service worker registration fails silently | Med | Task 5 uses typed `virtual:pwa-register`. Task 8 verifies `/sw.js` returns 200 with correct mime. Manual Task 10 confirms registration in DevTools. |

---

## Rollback Plan

If PWA breaks production:

1. Revert the SW registration: `git revert <sha-of-task-5>`
2. Browsers stop registering new SWs immediately. Already-installed SWs need an unregister; safest is to ship a no-op `sw.js` that calls `self.registration.unregister()` and `self.clients.claim()`.
3. To fully kill: in DevTools (or tell users) → Application → Service Workers → Unregister.

---

## Completion Criteria

- [ ] `npm run build` produces `dist/sw.js`, `dist/manifest.webmanifest`, and PNG icons.
- [ ] `npm run typecheck` passes.
- [ ] On a stable origin, Chrome DevTools → Application → Manifest shows our manifest with no errors.
- [ ] On a stable origin, Service Worker registers and shows "activated".
- [ ] On Android Chrome, the install prompt shows in-app and "Install app" works from browser menu.
- [ ] On iOS Safari, "Add to Home Screen" produces a standalone-mode launch.
- [ ] On `*.trycloudflare.com`, the in-app install prompt is hidden.
- [ ] README documents the Tailscale Funnel + `PUBLIC_URL` setup.
- [ ] No regressions: pairing flow, message send, WebSocket events, file upload all work as before.
