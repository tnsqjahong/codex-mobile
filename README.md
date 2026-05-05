# Codex Mobile Companion

Mobile companion for using the local Codex session layer from a phone.

This project intentionally uses **local-session mode** only:

- `npm start` opens a desktop pairing page and creates a temporary HTTPS tunnel when possible.
- The QR code pairs a phone for the lifetime of the desktop companion process.
- If the desktop companion/tunnel restarts, the user scans a fresh QR.
- No hosted relay, paid domain, ngrok account, or long-lived remote service is required.
- Notifications are session notifications: they work while the mobile browser remains connected to the desktop bridge.

The bridge starts `codex app-server` over stdio and exposes a small HTTP/WebSocket API for the mobile UI. It does not read Codex SQLite/JSONL state directly. The mobile client is built with Vite + React + TypeScript/TSX and served by the bridge from `dist/`.

## Run

First, install dependencies and check your desktop setup:

```sh
npm run setup
```

Then start the local companion:

```sh
npm start
```

`npm start` builds the mobile client, starts the bridge in the background, creates a temporary HTTPS remote tunnel when possible, opens the desktop pairing window, checks Codex CLI/login status there, warms Codex App Server, and shows a QR that can be opened from mobile data. After the pairing window opens, the terminal that launched `npm start` can be closed.

For foreground logs while developing:

```sh
npm run start:foreground
```

Later, when installed globally, the same launcher is available as:

```sh
npm link
codex-mobile
```

Development URL:

```text
http://127.0.0.1:8787
```

LAN phone pairing:

```sh
npm start -- --local
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
- `POST /api/uploads`
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
- Vite + React + TypeScript/TSX mobile web shell with project/thread/detail views.
- Desktop-like composer controls for branch switching/creation, combined model/reasoning selection, permission menu, chat, and changes.
- Compact composer token usage dial backed by App Server `thread/tokenUsage/updated` events.
- Working-tree changes endpoint backed by Git status/diff data.
- Commit-all action for current working-tree changes from the mobile changes panel.
- New thread creation and project/thread search UI.
- Settings surface for account, rate limits, runtime config, plugins, skills, apps, MCP servers, and automations.
- Desktop-style `$skill`, `@context`, and `/command` composer pickers backed by App Server skills, fuzzy file search, apps, plugins, and thread actions.
- Mobile image/file attachments in the chat composer. Images are sent as Codex `localImage` inputs; files are staged on the desktop and referenced by local path.
- Installable PWA (manifest, service worker, iOS-compatible meta tags). The in-app install prompt is suppressed on temporary tunnel origins (`*.trycloudflare.com`, `*.ngrok.app`, `*.loca.lt`); it activates on stable origins (Tailscale Funnel `*.ts.net`, LAN IP, custom domains).
- Message send with model/effort overrides, interrupt, approval response, and WebSocket event handling hooks.
- Session notifications for approval requests and completed Codex turns while the mobile browser is connected.
- QR-time Codex App Server and project-cache prewarm so mobile opens quickly after scanning.

Known next work:

- Test message sending and streaming against a disposable Codex thread.
- Harden approval response shapes for `item/permissions/requestApproval`.
- Add paired-device revocation, desktop-side pairing confirmation, and plugin/automation mutation UI.

## Stable URL for "install once" PWA (optional)

By default, `npm start` creates a temporary `*.trycloudflare.com` tunnel that
rotates per session — fine for QR pairing, not for installing the app to your
phone home screen.

If you want a permanent URL so the PWA installs once and survives desktop
restarts, expose the bridge through a stable origin and pass it via
`PUBLIC_URL`. Recommended free setup:

### Tailscale Funnel (automated)

One-time setup on the desktop:

1. Install Tailscale and sign in with any account (Google/GitHub/etc).
2. Run `npm run setup`. The doctor checks for the Tailscale CLI and login,
   detects whether Funnel is already enabled for the bridge port, and — if
   not — offers to enable it for you (sudo password required, one prompt):

   ```text
   Tailscale Funnel (optional, for stable PWA URL):
     Funnel for port 8787 is not configured (device: my-mac.tail-xxxx.ts.net).
            Enable now (sudo password required)? [y/N] y
     OK   Funnel enabled at https://my-mac.tail-xxxx.ts.net
   ```

3. Done. From now on, `npm start` automatically detects the active Funnel
   and uses its URL for the mobile QR — no `PUBLIC_URL` env var needed.

To enable manually instead, run `sudo tailscale funnel --bg 8787` once.

Open the QR'd URL on your phone, complete pairing, then **Add to Home
Screen** (iOS Safari) or tap **Install** when the in-app prompt appears
(Android Chrome). The icon survives desktop restarts; only the per-session
pairing token is renewed on next launch.

### Override priority

`PUBLIC_URL` env var > detected Tailscale Funnel > Cloudflare quick tunnel.
Set `PUBLIC_URL` only if you want to pin the QR to a different stable
origin (e.g. Cloudflare named tunnel on your own domain).

### Notes

- Tailscale Funnel is free on the Personal plan (April 2026 update: 6 users,
  unlimited devices, Funnel included).
- The pairing token is still per-session; this only fixes the URL, not the
  token. Long-lived device tokens are tracked as future work.
- Tailscale Funnel exposes the URL publicly. The pairing-token check still
  gates every API call, identical to the temporary tunnel mode.

### Other stable origins

Any stable HTTPS origin works — Cloudflare named tunnels with your own
domain, ngrok paid subdomains, self-hosted reverse proxies, or even a fixed
LAN IP for same-network use. Set `PUBLIC_URL` accordingly.

## Notification scope

Closed-app push notifications remain out of scope: this project only delivers
notifications while the paired mobile browser/PWA is connected during the
current desktop session.

## Simple User Path

Developer preview:

```sh
git clone <repo-url>
cd codex-mobile
npm run setup
npm start
```

The setup command installs the TypeScript/Vite client dependencies and checks the local Codex setup. A packaged desktop wrapper can later run the same checks and bridge without exposing Terminal.

In the packaged desktop app, users should not run `codex login --device-auth` themselves. The app should start that flow internally when needed, wait for the browser-based OpenAI login to complete, then enable the QR button.

## License

MIT
