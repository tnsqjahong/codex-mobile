# Codex Mobile Companion Development Spec

## Goal

Build a mobile web app that lets a user connect their phone to the Codex runtime already running on their computer. The phone should feel like a lightweight Codex App surface: browse projects, open existing Codex threads, read chat history, send messages, stream agent progress, and handle approvals.

The mobile client should not mirror the desktop screen. It should use the same Codex session/thread layer that Codex Desktop, Codex CLI, and IDE clients already share.

Current product decision: ship local-session mode only. The desktop companion creates a temporary QR pairing URL for the current run, the phone connects for that desktop session, and users scan a fresh QR after restart. Do not introduce hosted relay, paid domain, ngrok account setup, or long-lived origin requirements in the default open-source path.

## Verified Codex Behavior

Observed integration facts:

- Codex Desktop stores session metadata under `~/.codex`.
- Fast thread/project index lives in `~/.codex/state_5.sqlite`.
- Main table is `threads`.
- Full conversation/event history lives in JSONL rollout files under `~/.codex/sessions/YYYY/MM/DD`.
- `threads.rollout_path` points to the JSONL for each thread.
- `~/.codex/session_index.jsonl` is a lightweight title/update index.
- `codex app-server` exposes the same thread data via JSON-RPC.

Important inference:

`source` can be misleading. Desktop-originated sessions may be recorded as `vscode`, so product grouping should not depend on `source`. Use `cwd`, `id`, `title/name`, `updatedAt`, and `rollout_path`/App Server thread metadata instead.

## Source Of Truth

Use Codex App Server as the primary integration surface.

Do not build the mobile app by reading SQLite/JSONL directly unless App Server is unavailable. Direct SQLite reads are useful for diagnostics only.

Preferred data path:

```text
Mobile Web App
  -> Desktop Bridge HTTP/WebSocket API
  -> codex app-server JSON-RPC
  -> Codex local state and session rollouts
```

Fallback diagnostic path:

```text
Desktop Bridge
  -> ~/.codex/state_5.sqlite
  -> ~/.codex/sessions/**/*.jsonl
```

## Codex App Server API Surface

Verified commands:

- `codex app-server`
- `codex app-server --listen ws://127.0.0.1:4500`
- `codex app-server generate-json-schema --out <dir>`
- `codex app-server generate-ts --out <dir>`
- `codex app-server proxy --sock <socket>`

Use stdio transport for the bridge MVP. It avoids exposing Codex App Server directly to the network.

JSON-RPC startup sequence:

```json
{ "method": "initialize", "id": 0, "params": { "clientInfo": { "name": "codex_mobile", "title": "Codex Mobile", "version": "0.1.0" } } }
```

```json
{ "method": "initialized", "params": {} }
```

Core methods for MVP:

- `thread/list`: list recent threads.
- `thread/start`: create a new conversation/work unit.
- `thread/read`: read one thread, optionally including turns.
- `thread/turns/list`: paginate turns for long threads.
- `thread/resume`: load an existing thread into App Server.
- `thread/name/set`, `thread/archive`, `thread/unarchive`, `thread/fork`, `thread/rollback`, `thread/compact/start`: Desktop-style thread lifecycle actions.
- `turn/start`: send a user message and start agent work.
- `turn/interrupt`: stop an active turn.
- `model/list`: read the same model picker options Codex Desktop exposes.
- `skills/list`: read installed skills for the current workspace and power the mobile `$skill` picker.
- `config/read`: read default model, reasoning effort, approval, and sandbox config.
- `account/read`, `account/rateLimits/read`: account and usage settings.
- `plugin/list`, `skills/list`, `app/list`, `mcpServerStatus/list`, `experimentalFeature/list`: Desktop settings/catalog surfaces.
- Server requests for approval:
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
- `item/permissions/requestApproval`

Bridge-level Git helpers for desktop parity:

- `GET /api/threads/:threadId/branches`: list local branches for the thread `cwd`.
- `POST /api/threads/:threadId/git/checkout`: checkout or create a branch in the thread `cwd`.
- `POST /api/threads/:threadId/git/commit`: stage and commit current working-tree changes after explicit mobile confirmation.
- `GET /api/threads/:threadId/token-usage`: return the latest cached token usage snapshot observed for the thread.
- `POST /api/uploads`: stage mobile-selected files into a desktop temp directory before sending a turn.

Useful events/items:

- `thread/started`
- `thread/status/changed`
- `thread/name/updated`
- `turn/started`
- `turn/completed`
- `turn/diff/updated`
- `thread/tokenUsage/updated`
- `item/started`
- `item/agentMessage/delta`
- `item/completed`
- `item/commandExecution/*`
- `item/fileChange/*`

## Product Model

### Project

A project is a grouping of threads by `cwd`.

Fields:

- `cwd`: absolute path.
- `name`: basename of `cwd`, unless a friendlier name is available later.
- `latestUpdatedAt`: max `thread.updatedAt`.
- `threadCount`.
- `recentThreads`.

### Thread

A Codex conversation/work unit.

Fields:

- `id`.
- `title`: App Server `name` or `title` or `preview`.
- `cwd`.
- `source`: informational only.
- `createdAt`.
- `updatedAt`.
- `status`.
- `modelProvider`.
- `model`, if available.
- `reasoningEffort`, if available.
- `gitInfo`, if available.
- `turns`, loaded on detail view.

### Turn

One user request and the agent work that follows.

Fields:

- `id`.
- `status`: `running`, `completed`, `interrupted`, `failed`, etc.
- `startedAt`.
- `completedAt`.
- `items`.

### Item

Renderable unit inside a turn.

Initial renderer support:

- `userMessage`: user chat bubble.
- `agentMessage`: assistant chat bubble, streaming deltas.
- `commandExecution`: compact tool/terminal card.
- `fileChange`: compact diff/change card.
- `webSearch`: compact research card if present.
- unknown item: debug-safe collapsed JSON summary.

## Desktop Bridge

The bridge is a local companion server running on the user's computer.

Responsibilities:

- Check whether `codex` is installed and expose the version.
- Check `codex login status` and guide the user through login if needed.
- Lazily start `codex app-server` after desktop readiness is confirmed.
- Spawn and own `codex app-server` over stdio.
- Perform JSON-RPC request/response correlation.
- Subscribe to and forward server notifications.
- Expose a small mobile-friendly HTTP/WebSocket API.
- Manage QR pairing.
- Manage mobile session tokens.
- Redact sensitive output before sending to mobile.
- Keep Codex App Server bound to local process/stdio, not public network.

Runtime:

- Node.js 20+.
- No direct new database for local-session mode; in-memory sessions are enough.

Current implementation note:

- The first implementation intentionally uses only Node built-ins: `http`, `crypto`, `child_process`, and a small WebSocket frame implementation.
- This keeps the bootstrap path dependency-free while the Codex App Server contract is still being validated.

## Bridge HTTP API

### `GET /health`

Returns bridge and app-server status.

Response:

```json
{
  "ok": true,
  "appServer": "ready",
  "version": "0.1.0"
}
```

### `GET /desktop/status`

Desktop setup readiness endpoint.

Response:

```json
{
  "ok": true,
  "codex": {
    "installed": true,
    "version": "0.125.0"
  },
  "login": {
    "loggedIn": true,
    "provider": "ChatGPT"
  },
  "appServer": "not_started",
  "bridgeUrl": "http://127.0.0.1:8787"
}
```

This is the endpoint a packaged desktop companion should use for the first-run setup wizard.

### `POST /desktop/login/start`

Desktop-only endpoint. Starts `codex login --device-auth` and captures stdout/stderr for the setup wizard.

Security rule:

- Only loopback requests may start or cancel desktop login.
- Mobile devices should never be able to trigger a desktop login process over LAN.

Companion UI behavior:

1. If already logged in, return `already_logged_in`.
2. Otherwise start the login process.
3. Poll `GET /desktop/login/status`.
4. When complete, call `GET /desktop/status` again.

### `GET /desktop/login/status`

Returns the current login flow state:

```json
{
  "status": "running",
  "running": true,
  "output": "Open https://...",
  "startedAt": 1777510000000,
  "completedAt": null,
  "exitCode": null
}
```

### `POST /desktop/login/cancel`

Desktop-only endpoint. Cancels a running login process.

### `POST /pair/start`

Desktop-only endpoint to create a short-lived pairing session.

Rules:

- Only loopback desktop requests may create a QR.
- The bridge must verify desktop readiness first: Codex CLI installed and Codex login complete.
- If readiness fails, return `409 setupRequired` and do not create a pairing code.

Response:

```json
{
  "pairingId": "pair_...",
  "code": "7F3K9Q",
  "expiresAt": 1777514000000,
  "qrUrl": "http://<desktop-lan-ip>:8787/pair?code=7F3K9Q"
}
```

### `POST /pair/complete`

Mobile endpoint called after scanning QR.

Request:

```json
{
  "code": "7F3K9Q",
  "deviceName": "iPhone",
  "devicePublicKey": "optional-later"
}
```

Response:

```json
{
  "accessToken": "short-lived-token",
  "refreshToken": "optional-later",
  "expiresAt": 1777517600000
}
```

For MVP, desktop confirmation can be skipped only on trusted LAN/dev builds. Product version should show a desktop approval prompt before issuing the token.

### `GET /projects`

Returns threads grouped by `cwd`.

Bridge implementation:

1. Call `thread/list` with `archived: false`, `sortKey: "updated_at"`, `sortDirection: "desc"`.
2. Group returned threads by `cwd`.
3. Return project summaries.

### `GET /threads`

Query params:

- `cwd` optional.
- `limit` optional, default `50`.
- `cursor` optional.
- `search` optional.

Bridge implementation:

Call `thread/list`.

### `POST /threads`

Creates a new thread and optionally starts the first turn.

Request:

```json
{
  "cwd": "/Users/me/project",
  "text": "첫 메시지",
  "model": "gpt-5.5",
  "effort": "high"
}
```

Bridge implementation:

1. Call `thread/start`.
2. If `text` is present, call `turn/start` on the new thread.
3. Return the created thread.

### `GET /threads/:threadId`

Returns thread metadata and recent turns.

Bridge implementation:

Call `thread/read` with `includeTurns: true`.

For long histories, use `thread/turns/list` after the detail MVP.

### `GET /models`

Returns Codex App Server model picker data plus the local default config.

Bridge implementation:

1. Call `model/list`.
2. Call `config/read`.
3. Return visible model options and summarized defaults for mobile controls.

### `GET /threads/:threadId/context`

Returns thread metadata, current Git context, and summarized config for the mobile header.

Fields:

- `thread`: `id`, title, `cwd`, `source`, `status`, timestamps, `gitInfo`.
- `git`: current repository root, branch, short SHA, dirty flag, status count.
- `config`: default model, reasoning effort, approval policy, reviewer, sandbox mode.

### `GET /threads/:threadId/changes`

Returns a Desktop-like working tree summary for the thread `cwd`.

Bridge implementation:

1. Read the thread via `thread/read`.
2. Run Git commands in the thread `cwd`, never through a shell.
3. Parse `git status --porcelain=v1 --untracked-files=all`.
4. Merge tracked file counts from `git diff --numstat` and `git diff --cached --numstat`.
5. Count lines for untracked text files so a freshly initialized repo still shows useful `+N` counts.
6. Include capped unified diffs for tracked files.

Response shape:

```json
{
  "ok": true,
  "branch": "main",
  "dirty": true,
  "summary": {
    "filesChanged": 6,
    "additions": 59,
    "deletions": 10
  },
  "files": [
    {
      "path": "src/client/App.tsx",
      "status": " M",
      "additions": 23,
      "deletions": 3,
      "diff": "..."
    }
  ],
  "turnDiff": {
    "turnId": "019...",
    "diff": "..."
  }
}
```

### `POST /threads/:threadId/actions`

Runs advanced thread actions. These remain available at the bridge layer, but the mobile UI keeps them out of the default chat surface.

Supported actions:

- `rename`: calls `thread/name/set`.
- `archive`: calls `thread/archive`.
- `unarchive`: calls `thread/unarchive`.
- `fork`: calls `thread/fork`.
- `rollback`: calls `thread/rollback` with `numTurns`.
- `compact`: calls `thread/compact/start`.

Rollback only modifies Codex thread history. It does not revert local file changes.

### `GET /settings`

Returns a mobile-safe settings bundle:

- account summary.
- rate limits.
- summarized runtime config.
- plugin marketplace entries.
- skills.
- apps/connectors.
- MCP server status with reduced detail.
- experimental features.
- local automation summaries.

### `POST /threads/:threadId/messages`

Sends a user message.

Request:

```json
{
  "text": "계속 진행해줘",
  "attachments": [
    {
      "name": "screenshot.png",
      "path": "/tmp/codex-mobile-uploads/.../screenshot.png",
      "mime": "image/png",
      "isImage": true
    }
  ],
  "model": "gpt-5.5",
  "effort": "high"
}
```

Bridge implementation:

1. Ensure thread is loaded with `thread/resume`.
2. Call `turn/start`:

```json
{
  "method": "turn/start",
  "params": {
    "threadId": "<threadId>",
    "model": "gpt-5.5",
    "effort": "high",
    "input": [
      { "type": "text", "text": "<message>" },
      { "type": "localImage", "path": "/tmp/codex-mobile-uploads/.../screenshot.png" }
    ]
  }
}
```

General files are staged on the desktop and appended to the turn as text with their local paths, because current `turn/start` user input supports text, image URL, `localImage`, skill, and mention inputs but not a generic file input.

Response:

```json
{
  "turnId": "019...",
  "status": "started"
}
```

### `POST /threads/:threadId/interrupt`

Bridge implementation:

Call `turn/interrupt`.

### `POST /approvals/:requestId`

Request:

```json
{
  "decision": "allow",
  "remember": false
}
```

Bridge implementation:

Respond to the server-initiated JSON-RPC approval request with the matching `id`.

### `WS /events`

Authenticated WebSocket for mobile UI.

Client message types:

- `subscribeThread`
- `unsubscribeThread`
- `ping`

Server message types:

- `threadUpdated`
- `turnStarted`
- `itemStarted`
- `itemDelta`
- `itemCompleted`
- `turnCompleted`
- `approvalRequested`
- `error`

## Mobile Web App

Implementation:

- Vite + React + TypeScript/TSX web shell.
- Browser-session notifications where the browser allows them.
- Lightweight in-memory state for HTTP and live thread events.

Primary views:

1. Pairing
   - QR URL landing.
   - connection status.
   - device name.
   - failure/retry states.

2. Workspace
   - project selector.
   - sidebar thread list.
   - local thread search.
   - new thread in current project.

3. Thread Detail
   - chat timeline.
   - compact command/file cards.
   - branch, combined model/reasoning menu, and permission menu.
   - changes tab with file list, counts, and tracked unified diffs.
   - message input.
   - compact token usage dial in the composer.
   - approval cards.

4. Settings
   - paired desktop.
   - disconnect/revoke.
   - bridge status.
   - account, usage, plugins, skills, apps, MCP servers, automations.

## QR And Web UX

What is possible:

- Desktop bridge can render a real QR code containing the pairing URL.
- Scanning the QR opens the mobile web app with `?pair=<code>`.
- The mobile experience runs as a browser web app for the current desktop session.

What is intentionally out of scope:

- A QR scan cannot silently auto-install a web app.
- A website cannot force an app download/install without the user's browser or OS confirmation.
- App install prompts are not shown because local-session tunnel URLs are temporary.

Recommended product UX:

1. User opens the desktop companion.
2. Desktop companion checks Codex CLI and Codex login automatically.
3. If login is missing, desktop companion starts the OpenAI login/device-auth flow itself.
4. Only after desktop setup is ready, desktop companion shows a large local QR code.
5. Desktop companion warms Codex App Server and the project/thread index while the QR is visible.
6. Phone camera opens the temporary pairing URL for this desktop session.
7. Mobile browser completes pairing and opens the Codex workspace shell.

Session notification scope:

- Use the active WebSocket session to surface approval-needed and turn-completed notifications while the mobile app/browser remains connected.
- Do not claim closed-app push support in local-session mode.
- Closed-app push requires a stable origin and Web Push subscription storage, which is intentionally out of scope for the default open-source path.

Mobile UX constraints:

- Keep UI dense and operational, like Codex App, not a marketing page.
- Bottom input should be stable and thumb-friendly.
- Tool cards should be collapsed by default.
- Long command output should be expandable.
- Approval cards must be visually distinct and hard to tap accidentally.

## Security

MVP security rules:

- Do not expose `codex app-server` directly to mobile.
- Bridge listens on localhost by default and uses a temporary HTTPS tunnel for mobile data access when available.
- QR pairing codes expire in 60 seconds.
- Access token expires quickly.
- Redact obvious secrets:
  - `OPENAI_API_KEY`
  - `sk-...`
  - private key blocks
  - `.env` lines
  - bearer tokens
- Raw shell input from mobile is out of scope for MVP.
- Mobile can only send chat messages, interrupt turns, and answer Codex approval prompts.

Production security:

- Desktop confirmation for pairing.
- Device key binding.
- Revocation UI.
- HTTPS tunnel health checks and clear desktop status.
- Audit log for mobile-originated messages and approvals.

## Implementation Phases

### Phase 0: Protocol Probe

Deliverable:

- Small script that starts `codex app-server`, initializes JSON-RPC, calls `thread/list`, `thread/read`, and exits.

Acceptance:

- Lists the same recent threads visible in Codex Desktop.
- Reads a selected thread by id.

### Phase 1: Bridge MVP

Deliverable:

- Node bridge with JSON-RPC client.
- HTTP endpoints:
  - `GET /health`
  - `GET /projects`
  - `GET /threads`
  - `GET /threads/:threadId`
  - `POST /threads/:threadId/messages`
  - `POST /threads/:threadId/interrupt`
- WebSocket event forwarding.

Acceptance:

- Can list projects grouped by `cwd`.
- Can read a thread.
- Can send a message to an existing thread.
- Can stream agent message deltas to a WebSocket client.

Current status:

- Implemented in `src/bridge`.
- Verified `thread/list`, project grouping, thread list, `thread/read`, `model/list`, `config/read`, thread context, Git changes, thread search, and settings bundle through the bridge.
- Message send and live delta streaming are wired, but should be tested against a disposable thread before being treated as production-safe.

### Phase 2: Mobile Web MVP

Deliverable:

- Mobile UI with project list, thread list, thread detail, message input.
- WebSocket event rendering.

Acceptance:

- User can open phone browser, select a project, open a thread, read history, send a message, and watch the response stream.

### Phase 3: QR Pairing

Deliverable:

- Pairing endpoint.
- QR display page on desktop bridge.
- Mobile pairing landing.
- Token-protected API.

Acceptance:

- User can scan QR and land in authenticated mobile UI.
- Expired QR cannot connect.
- Disconnect invalidates token.

Current status:

- Pairing code and QR target URL are implemented.
- Actual local QR SVG rendering is implemented in `src/bridge/qr.js`.
- By default, `npm start` attempts a temporary HTTPS tunnel for phone access over mobile data.
- For LAN-only pairing, run `npm start -- --local`.

### Phase 4: Approvals And Tool Cards

Deliverable:

- Approval request rendering.
- Approval response endpoint.
- Command/file change cards.

Acceptance:

- If Codex asks for command/file approval, mobile can allow/deny.
- Command output streams into compact cards.

### Phase 5: Packaging

Deliverable:

- One command to run bridge and web app locally.
- TypeScript/TSX mobile client build.
- Optional macOS LaunchAgent/tray wrapper.

Acceptance:

- User starts bridge, scans QR, and uses mobile UI for the current desktop session without touching terminal details.

## Open Questions

- Whether to use `codex app-server proxy --sock` to attach to an already-running Desktop App app-server process, or always spawn our own app-server process.
- Whether Desktop App live refreshes immediately when mobile updates a thread, or only after its own polling/reload. This is not a blocker because the shared local state updates correctly.
- Whether plugin install/uninstall, automation create/update/delete, and account logout should be allowed from mobile or limited to read-only settings for safety.

## Immediate Next Development Tasks

1. Run a disposable end-to-end turn from mobile and verify Desktop sees the resulting shared thread state.
2. Harden approval response mapping per approval request schema.
3. Add paired-device revocation and desktop-side confirmation.
4. Add plugin/automation mutation screens only after safety review.
5. Package the desktop bridge as a double-clickable macOS companion.
