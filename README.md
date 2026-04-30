# Codex Mobile Companion

Mobile-first PWA prototype for connecting a phone to the local Codex session layer exposed by `codex app-server`.

The bridge does not read Codex SQLite/JSONL state directly. It starts `codex app-server` over stdio, then exposes a small HTTP/WebSocket API for the mobile UI.

## Run

First, check your desktop setup:

```sh
npm run setup
```

Then start the local companion:

```sh
npm start
```

Development URL:

```text
http://127.0.0.1:8787
```

LAN phone pairing:

```sh
HOST=0.0.0.0 npm start
```

If the advertised LAN URL is not what the phone can reach, set it explicitly:

```sh
HOST=0.0.0.0 PUBLIC_URL=http://192.168.0.10:8787 npm start
```

## Verify App Server Access

```sh
npm run probe
```

Expected result: recent Codex threads are printed, including threads visible in Codex Desktop.

## Current API

- `GET /api/health`
- `GET /api/desktop/status`
- `POST /api/desktop/login/start`
- `GET /api/desktop/login/status`
- `POST /api/desktop/login/cancel`
- `POST /api/pair/start`
- `POST /api/pair/complete`
- `GET /api/projects`
- `POST /api/threads`
- `GET /api/models`
- `GET /api/skills`
- `GET /api/settings`
- `GET /api/threads?cwd=<path>`
- `GET /api/threads/:threadId`
- `GET /api/threads/:threadId/context`
- `GET /api/threads/:threadId/changes`
- `GET /api/threads/:threadId/token-usage`
- `GET /api/threads/:threadId/branches`
- `POST /api/threads/:threadId/git/checkout`
- `POST /api/threads/:threadId/git/commit`
- `POST /api/threads/:threadId/actions`
- `POST /api/threads/:threadId/messages`
- `POST /api/threads/:threadId/interrupt`
- `POST /api/approvals/:requestId`
- `WS /api/events?token=<accessToken>`

## Status

Implemented:

- Dependency-free Node bridge.
- Codex JSON-RPC stdio client.
- Desktop readiness check for Codex CLI installation, Codex login status, and lazy App Server startup.
- Desktop OpenAI login flow launcher backed by `codex login --device-auth`.
- Project grouping by `cwd`.
- Thread list and thread detail reads.
- Short-lived pairing code and bearer token.
- Local QR SVG generation for pairing URLs.
- Mobile PWA shell with project/thread/detail views.
- Desktop-like thread controls for branch switching/creation, model, reasoning effort, permission summary, chat, and changes.
- Live thread token usage meter backed by App Server `thread/tokenUsage/updated` events.
- Working-tree changes endpoint backed by Git status/diff data.
- Commit-all action for current working-tree changes from the mobile changes panel.
- New thread creation, project/thread search UI, stop button, and thread actions for rename, fork, compact, rollback, and archive.
- Settings surface for account, rate limits, runtime config, plugins, skills, apps, MCP servers, and automations.
- Desktop-style `$skill` picker in the chat composer, backed by installed skills from App Server.
- PWA install CTA for Android Chromium and in-app Home Screen guidance for iOS Safari.
- Message send with model/effort overrides, interrupt, approval response, and WebSocket event handling hooks.

Known next work:

- Test message sending and streaming against a disposable Codex thread.
- Harden approval response shapes for `item/permissions/requestApproval`.
- Add paired-device revocation, desktop-side pairing confirmation, and plugin/automation mutation UI.

## Install Reality

The QR code can open the paired mobile web app, but it cannot silently install it. Android Chromium can show a user-approved PWA install prompt. iOS requires Safari's Add to Home Screen flow for PWAs, or a native App Clip/App Store path for a more app-like scan experience.

## Simple User Path

Developer preview:

```sh
git clone <repo-url>
cd codex-mobile
npm run setup
npm start
```

The setup command requires no npm install because the prototype has no external dependencies. For general users, this should become a packaged macOS desktop app that bundles Node or a compiled runtime, runs the same checks in a first-run wizard, and starts the bridge without exposing Terminal.

In the packaged desktop app, users should not run `codex login --device-auth` themselves. The app should start that flow internally when needed, wait for the browser-based OpenAI login to complete, then enable the QR button.
