import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CodexRpc, redact } from "./codex-rpc.js";
import { createQrSvg } from "./qr.js";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const publicDir = path.join(rootDir, "public");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const rpc = new CodexRpc();
const sseClients = new Set();
let sseHeartbeatTimer = null;
let ticketSweepTimer = null;
const SSE_HEARTBEAT_MS = 25_000;
const TICKET_SWEEP_MS = 60_000;
const TICKET_TTL_MS = 30_000;
const SSE_BUFFER_MAX = 500;
const EVENT_LOOKUP_MAX = 2_000;
let sseEventCounter = 0;
const sseEventBuffer = [];
const tickets = new Map();
const pairings = new Map();
const sessions = new Map();
const activeTurns = new Map();
const turnThreads = new Map();
const itemThreads = new Map();
const diffSnapshots = new Map();
const tokenUsageSnapshots = new Map();
const responseCache = new Map();
const localPreviewFiles = new Map();
const CACHE_TTL_MS = 120_000;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const UPLOAD_ROOT = path.join(os.tmpdir(), "codex-mobile-uploads");
const PREVIEW_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CHANGE_FILES = 160;
const MAX_CHANGE_DIFF_BYTES = 120_000;
const MAX_WORKSPACE_GIT_REPOS = 40;
const WORKSPACE_GIT_SCAN_DEPTH = 3;
const GIT_SCAN_SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  ".vite",
  ".omx",
  ".playwright-cli",
  "coverage",
  "dist",
  "node_modules",
]);
let publicBaseUrlOverride = process.env.PUBLIC_URL?.replace(/\/$/, "") || null;
let loginProcess = null;
let loginFlow = {
  status: "idle",
  output: "",
  startedAt: null,
  completedAt: null,
  exitCode: null,
};
let appServerStarted = false;
let appServerStartPromise = null;

rpc.on("notification", (message) => {
  trackTurn(message);
  broadcast({
    type: "codexEvent",
    threadId: extractThreadId(message),
    event: JSON.parse(redact(message)),
  });
});

rpc.on("serverRequest", (message) => {
  broadcast({
    type: "approvalRequested",
    threadId: extractThreadId(message),
    requestId: String(message.id),
    method: message.method,
    params: JSON.parse(redact(message.params ?? {})),
  });
});

rpc.on("stderr", (text) => {
  if (!text.includes("could not update PATH")) console.warn(text.trim());
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
});

server.on("upgrade", (req, socket) => {
  // SSE migration: no WebSocket upgrade endpoints exist anymore.
  socket.destroy();
});

server.listen(port, host, () => {
  console.log(`Codex Mobile Companion running on ${getPublicBaseUrl()}`);
  if (host !== "0.0.0.0") {
    console.log("Set HOST=0.0.0.0 to pair from a phone on the same network.");
  }
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  if (sseHeartbeatTimer) {
    clearInterval(sseHeartbeatTimer);
    sseHeartbeatTimer = null;
  }
  if (ticketSweepTimer) {
    clearInterval(ticketSweepTimer);
    ticketSweepTimer = null;
  }
  for (const client of sseClients) {
    try { client.res.end(); } catch {}
  }
  sseClients.clear();
  sseEventBuffer.length = 0;
  tickets.clear();
  rpc.stop();
  server.close(() => process.exit(0));
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      appServer: appServerStarted ? "ready" : "not_started",
      bridgeUrl: getPublicBaseUrl(),
      version: "0.1.0",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/desktop/status") {
    sendJson(res, 200, await getDesktopStatus());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/public-url") {
    if (!isDesktopBrowserRequest(req)) {
      sendJson(res, 403, { error: "Public URL can only be updated from this computer" });
      return;
    }
    const body = await readJson(req);
    publicBaseUrlOverride = normalizePublicUrl(body.publicUrl);
    sendJson(res, 200, { publicUrl: publicBaseUrlOverride });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/login/start") {
    if (!isDesktopBrowserRequest(req)) {
      sendJson(res, 403, { error: "Desktop login can only be started from this computer" });
      return;
    }
    sendJson(res, 200, await startDesktopLogin());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/desktop/login/status") {
    sendJson(res, 200, getPublicLoginFlow());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/login/cancel") {
    if (!isDesktopBrowserRequest(req)) {
      sendJson(res, 403, { error: "Desktop login can only be cancelled from this computer" });
      return;
    }
    cancelDesktopLogin();
    sendJson(res, 200, getPublicLoginFlow());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pair/start") {
    if (!isDesktopBrowserRequest(req)) {
      sendJson(res, 403, { error: "Pairing QR can only be created from this computer" });
      return;
    }
    const desktop = await getDesktopStatus();
    if (!desktop.ok) {
      sendJson(res, 409, {
        error: "Finish desktop setup before pairing a phone",
        setupRequired: true,
        desktop,
      });
      return;
    }
    prewarmProjectCache().catch((error) => {
      console.warn(`Failed to prewarm Codex projects: ${error.message || error}`);
    });
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    // Pairing codes live for the lifetime of this server process. The
    // in-memory `pairings` Map is wiped on restart, so a code's validity
    // is effectively bounded by uptime. Time-based expiry was removed at
    // the user's request (avoid having to refresh every few minutes).
    const expiresAt = Number.MAX_SAFE_INTEGER;
    const qrUrl = `${getPublicBaseUrl()}/?pair=${code}`;
    pairings.set(code, { expiresAt, qrUrl });
    sendJson(res, 200, {
      code,
      expiresAt,
      qrUrl,
      qrSvg: createQrSvg(qrUrl),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pair/complete") {
    const body = await readJson(req);
    const pairing = pairings.get(body.code);
    if (!pairing || pairing.expiresAt < Date.now()) {
      sendJson(res, 401, { error: "Pairing code expired" });
      return;
    }
    pairings.delete(body.code);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_TTL_MS;
    sessions.set(token, { deviceName: body.deviceName || "Mobile", expiresAt, lastSeenAt: Date.now() });
    sendJson(res, 200, { accessToken: token, expiresAt });
    return;
  }

  if (!isAuthorized(req, url)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/events/ticket") {
    const ticket = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    tickets.set(ticket, { userToken: req._authToken, expiresAt });
    sendJson(res, 200, { ticket, expiresAt });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/events") {
    handleSseEvents(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/local-file") {
    await sendLocalImage(res, {
      previewId: url.searchParams.get("id"),
      filePath: url.searchParams.get("path"),
      cwd: url.searchParams.get("cwd"),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/uploads") {
    const body = await readJson(req, { maxBytes: MAX_UPLOAD_BYTES * 2 });
    sendJson(res, 200, { files: await saveUploads(body.files || []) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    await ensureAppServerStarted();
    const limit = Number(url.searchParams.get("limit") || 100);
    const projects = await cachedResponse(`projects:${limit}`, async () => {
      const threads = await listThreads({ limit });
      return groupProjects(threads);
    });
    sendJson(res, 200, { projects });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/threads") {
    await ensureAppServerStarted();
    invalidateResponseCache();
    const body = await readJson(req);
    const threadParams = {
      cwd: body.cwd || null,
      model: body.model || null,
      ephemeral: false,
    };
    const result = await rpc.request("thread/start", threadParams);
    const createdThread = normalizeThreadStartResult(result, body.cwd);
    const threadId = createdThread?.id;
    let startedTurn = null;
    if (threadId && (body.text?.trim() || hasAttachments(body.attachments) || hasMentions(body.mentions))) {
      const turnParams = {
        threadId,
        input: buildTurnInput(body.text, body.attachments, body.mentions, body.cwd),
      };
      if (body.model) turnParams.model = String(body.model);
      if (body.effort) turnParams.effort = String(body.effort);
      if (body.approvalPolicy) turnParams.approvalPolicy = body.approvalPolicy;
      startedTurn = await rpc.request("turn/start", turnParams);
    }
    sendJson(res, 200, {
      ...(result || {}),
      thread: createdThread,
      threadId,
      startedTurn,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/threads") {
    await ensureAppServerStarted();
    const cwd = url.searchParams.get("cwd");
    const searchTerm = url.searchParams.get("search");
    const cursor = url.searchParams.get("cursor");
    const limit = Number(url.searchParams.get("limit") || 50);
    const result = await cachedResponse(`threads:${cwd || ""}:${cursor || ""}:${limit}:${searchTerm || ""}`, () => rpc.request("thread/list", {
      archived: false,
      cursor,
      limit,
      searchTerm,
      sortKey: "updated_at",
      sortDirection: "desc",
      cwd: cwd || null,
    }));
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings") {
    await ensureAppServerStarted();
    const cwd = url.searchParams.get("cwd");
    const [account, rateLimits, config, requirements, plugins, skills, apps, mcpServers, features, automations] = await Promise.all([
      rpc.request("account/read", { refreshToken: false }).catch((error) => ({ error: cleanCommandOutput(error.message || error) })),
      rpc.request("account/rateLimits/read", {}).catch((error) => ({ error: cleanCommandOutput(error.message || error) })),
      rpc.request("config/read", {}).catch((error) => ({ error: cleanCommandOutput(error.message || error) })),
      rpc.request("configRequirements/read", {}).catch((error) => ({ error: cleanCommandOutput(error.message || error) })),
      rpc.request("plugin/list", { cwds: cwd ? [cwd] : null }).catch((error) => ({ error: cleanCommandOutput(error.message || error), marketplaces: [] })),
      rpc.request("skills/list", { cwds: cwd ? [cwd] : [], forceReload: false }).catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] })),
      rpc.request("app/list", { limit: 100 }).catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] })),
      rpc.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 100 }).catch((error) => ({ error: cleanCommandOutput(error.message || error), mcpServers: [] })),
      rpc.request("experimentalFeature/list", {}).catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] })),
      listAutomations().catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] })),
    ]);
    sendJson(res, 200, {
      account,
      rateLimits,
      config: { summary: summarizeConfig(config.config || {}) },
      requirements: summarizeRequirements(requirements),
      plugins: summarizePlugins(plugins),
      skills: summarizeSkills(skills),
      apps: summarizeApps(apps),
      mcpServers: summarizeMcpServers(mcpServers),
      features: summarizeFeatures(features),
      automations,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    await ensureAppServerStarted();
    const [models, config] = await Promise.all([
      rpc.request("model/list", { limit: 100 }).catch(() => ({ data: [] })),
      rpc.request("config/read", {}).catch(() => ({ config: {} })),
    ]);
    sendJson(res, 200, {
      models: models.data || [],
      nextCursor: models.nextCursor || null,
      config: summarizeConfig(config.config || {}),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/skills") {
    await ensureAppServerStarted();
    const cwd = url.searchParams.get("cwd");
    const skills = await rpc.request("skills/list", { cwds: cwd ? [cwd] : [], forceReload: false })
      .catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] }));
    sendJson(res, 200, { data: flattenSkills(summarizeSkills(skills)) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/mentions") {
    await ensureAppServerStarted();
    const cwd = url.searchParams.get("cwd");
    const query = url.searchParams.get("query") || "";
    sendJson(res, 200, await searchMentions(cwd, query));
    return;
  }

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (req.method === "GET" && threadMatch) {
    await ensureAppServerStarted();
    const result = await rpc.request("thread/read", {
      threadId: decodeURIComponent(threadMatch[1]),
      includeTurns: true,
    });
    // Anchor for gap-free SSE resume: client passes this back as ?lastEventId=
    // when (re)opening EventSource so the ring buffer replays anything that
    // arrived between this snapshot and the SSE handshake.
    sendJson(res, 200, { ...result, latestEventId: String(sseEventCounter) });
    return;
  }

  const threadActionMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/actions$/);
  if (req.method === "POST" && threadActionMatch) {
    await ensureAppServerStarted();
    invalidateResponseCache();
    const threadId = decodeURIComponent(threadActionMatch[1]);
    const body = await readJson(req);
    const result = await handleThreadAction(threadId, body);
    sendJson(res, 200, result || { ok: true });
    return;
  }

  const contextMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/context$/);
  if (req.method === "GET" && contextMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(contextMatch[1]);
    const [threadResult, configResult] = await Promise.all([
      rpc.request("thread/read", { threadId, includeTurns: false }),
      rpc.request("config/read", {}).catch(() => ({ config: {} })),
    ]);
    const thread = threadResult.thread;
    const git = await getGitContext(thread.cwd).catch((error) => ({
      ok: false,
      error: cleanCommandOutput(error.message || String(error)),
    }));
    sendJson(res, 200, {
      thread: summarizeThread(thread),
      git,
      config: summarizeConfig(configResult.config || {}),
    });
    return;
  }

  const changesMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/changes$/);
  if (req.method === "GET" && changesMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(changesMatch[1]);
    const threadResult = await rpc.request("thread/read", { threadId, includeTurns: false });
    const changes = await getGitChanges(threadResult.thread.cwd);
    const turnDiff = diffSnapshots.get(threadId) || null;
    sendJson(res, 200, { ...changes, threadId, turnDiff });
    return;
  }

  const tokenUsageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/token-usage$/);
  if (req.method === "GET" && tokenUsageMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(tokenUsageMatch[1]);
    sendJson(res, 200, {
      threadId,
      tokenUsage: tokenUsageSnapshots.get(threadId) || null,
    });
    return;
  }

  const branchesMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/branches$/);
  if (req.method === "GET" && branchesMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(branchesMatch[1]);
    const threadResult = await rpc.request("thread/read", { threadId, includeTurns: false });
    sendJson(res, 200, await getGitBranches(threadResult.thread.cwd));
    return;
  }

  const checkoutMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/git\/checkout$/);
  if (req.method === "POST" && checkoutMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(checkoutMatch[1]);
    const body = await readJson(req);
    const threadResult = await rpc.request("thread/read", { threadId, includeTurns: false });
    sendJson(res, 200, await checkoutGitBranch(threadResult.thread.cwd, body.branch, Boolean(body.create)));
    return;
  }

  const commitMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/git\/commit$/);
  if (req.method === "POST" && commitMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(commitMatch[1]);
    const body = await readJson(req);
    const threadResult = await rpc.request("thread/read", { threadId, includeTurns: false });
    sendJson(res, 200, await commitGitChanges(threadResult.thread.cwd, body.message, Boolean(body.stageAll)));
    return;
  }

  const messageMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/messages$/);
  if (req.method === "POST" && messageMatch) {
    await ensureAppServerStarted();
    invalidateResponseCache();
    const threadId = decodeURIComponent(messageMatch[1]);
    const body = await readJson(req);
    if (!body.text?.trim() && !hasAttachments(body.attachments) && !hasMentions(body.mentions)) {
      sendJson(res, 400, { error: "Missing message" });
      return;
    }
    await rpc.request("thread/resume", { threadId });
    const threadResult = await rpc.request("thread/read", { threadId, includeTurns: false });
    const params = {
      threadId,
      input: buildTurnInput(body.text, body.attachments, body.mentions, threadResult.thread?.cwd),
    };
    if (body.model) params.model = String(body.model);
    if (body.effort) params.effort = String(body.effort);
    if (body.approvalPolicy) params.approvalPolicy = body.approvalPolicy;
    const result = await rpc.request("turn/start", params);
    sendJson(res, 200, result || { status: "started" });
    return;
  }

  const interruptMatch = url.pathname.match(/^\/api\/threads\/([^/]+)\/interrupt$/);
  if (req.method === "POST" && interruptMatch) {
    await ensureAppServerStarted();
    const threadId = decodeURIComponent(interruptMatch[1]);
    const body = await readJson(req).catch(() => ({}));
    let turnId = body.turnId || activeTurns.get(threadId);
    if (!turnId) {
      const threadResult = await rpc.request("thread/read", { threadId, includeTurns: true }).catch(() => null);
      turnId = findActiveTurnId(threadResult?.thread);
    }
    if (!turnId) {
      sendJson(res, 409, { error: "No active turn for thread" });
      return;
    }
    const result = await rpc.request("turn/interrupt", { threadId, turnId });
    sendJson(res, 200, result || { status: "interrupted" });
    return;
  }

  const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (req.method === "POST" && approvalMatch) {
    await ensureAppServerStarted();
    const requestId = decodeURIComponent(approvalMatch[1]);
    const body = await readJson(req);
    const decision = mapApprovalDecision(body.decision, body.remember);
    rpc.respond(requestId, decision);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function ensureAppServerStarted() {
  if (appServerStarted) return;
  if (!appServerStartPromise) {
    appServerStartPromise = rpc.start().then(() => {
      appServerStarted = true;
    }).catch((error) => {
      appServerStartPromise = null;
      throw error;
    });
  }
  await appServerStartPromise;
}

async function handleThreadAction(threadId, body) {
  const action = body.action;
  if (action === "rename") {
    if (!body.name?.trim()) throw new Error("Missing thread name");
    return rpc.request("thread/name/set", { threadId, name: body.name.trim() });
  }
  if (action === "archive") return rpc.request("thread/archive", { threadId });
  if (action === "unarchive") return rpc.request("thread/unarchive", { threadId });
  if (action === "fork") {
    return rpc.request("thread/fork", {
      threadId,
      cwd: body.cwd || null,
      model: body.model || null,
      ephemeral: false,
      excludeTurns: false,
    });
  }
  if (action === "rollback") {
    return rpc.request("thread/rollback", {
      threadId,
      numTurns: Math.max(1, Number(body.numTurns || 1)),
    });
  }
  if (action === "compact") return rpc.request("thread/compact/start", { threadId });
  throw new Error(`Unsupported thread action: ${action}`);
}

async function getDesktopStatus() {
  const [codex, login] = await Promise.all([getCodexVersion(), getCodexLoginStatus()]);
  return {
    ok: Boolean(codex.installed && login.loggedIn),
    codex,
    login,
    loginFlow: getPublicLoginFlow(),
    appServer: appServerStarted ? "ready" : "not_started",
    bridgeUrl: getPublicBaseUrl(),
  };
}

async function startDesktopLogin() {
  const login = await getCodexLoginStatus();
  if (login.loggedIn) {
    loginFlow = {
      status: "already_logged_in",
      output: login.raw || "Logged in",
      startedAt: Date.now(),
      completedAt: Date.now(),
      exitCode: 0,
    };
    return getPublicLoginFlow();
  }

  if (loginProcess) return getPublicLoginFlow();

  loginFlow = {
    status: "running",
    output: "",
    startedAt: Date.now(),
    completedAt: null,
    exitCode: null,
  };

  try {
    loginProcess = spawn("codex", ["login", "--device-auth"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    loginFlow.status = "failed";
    loginFlow.completedAt = Date.now();
    appendLoginOutput(error.message || String(error));
    return getPublicLoginFlow();
  }

  loginProcess.stdout.on("data", (chunk) => appendLoginOutput(chunk));
  loginProcess.stderr.on("data", (chunk) => appendLoginOutput(chunk));
  loginProcess.on("error", (error) => {
    loginFlow.status = "failed";
    loginFlow.completedAt = Date.now();
    appendLoginOutput(error.message || String(error));
    loginProcess = null;
  });
  loginProcess.on("close", (code, signal) => {
    loginFlow.exitCode = code;
    loginFlow.completedAt = Date.now();
    if (loginFlow.status === "cancelled") {
      appendLoginOutput("Login cancelled.");
    } else if (code === 0) {
      loginFlow.status = "completed";
      appendLoginOutput("Login completed.");
    } else {
      loginFlow.status = "failed";
      appendLoginOutput(`Login exited with ${signal || code}.`);
    }
    loginProcess = null;
  });

  return getPublicLoginFlow();
}

function cancelDesktopLogin() {
  if (!loginProcess) return;
  loginFlow.status = "cancelled";
  loginFlow.completedAt = Date.now();
  loginProcess.kill("SIGTERM");
}

function appendLoginOutput(chunk) {
  const output = cleanCommandOutput(redact(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)));
  if (!output) return;
  loginFlow.output = `${loginFlow.output ? `${loginFlow.output}\n` : ""}${output}`.slice(-8000);
}

function getPublicLoginFlow() {
  return { ...loginFlow, running: Boolean(loginProcess) };
}

async function getCodexVersion() {
  try {
    const result = await execFile("codex", ["--version"], { timeout: 5000 });
    const output = cleanCommandOutput(`${result.stdout}${result.stderr}`);
    return {
      installed: true,
      version: output.split(/\s+/).find((part) => /\d+\.\d+\.\d+/.test(part)) || null,
      raw: output,
    };
  } catch (error) {
    return {
      installed: false,
      version: null,
      error: cleanCommandOutput(`${error.stdout || ""}${error.stderr || ""}${error.message || error}`),
    };
  }
}

async function getCodexLoginStatus() {
  try {
    const result = await execFile("codex", ["login", "status"], { timeout: 5000 });
    const output = cleanCommandOutput(`${result.stdout}${result.stderr}`);
    return {
      loggedIn: /Logged in/i.test(output),
      provider: output.match(/Logged in using (.+)$/i)?.[1] || null,
      raw: output,
    };
  } catch (error) {
    const output = cleanCommandOutput(`${error.stdout || ""}${error.stderr || ""}${error.message || error}`);
    return {
      loggedIn: false,
      provider: null,
      error: output,
    };
  }
}

function cleanCommandOutput(output) {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("could not update PATH"))
    .join("\n");
}

async function cachedResponse(key, load) {
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.value;
  const value = await load();
  responseCache.set(key, { value, createdAt: Date.now() });
  return value;
}

function invalidateResponseCache() {
  responseCache.clear();
}

async function prewarmProjectCache() {
  await ensureAppServerStarted();
  await cachedResponse("projects:100", async () => {
    const threads = await listThreads({ limit: 100 });
    return groupProjects(threads);
  });
}

async function listThreads({ limit }) {
  const result = await rpc.request("thread/list", {
    archived: false,
    limit,
    sortKey: "updated_at",
    sortDirection: "desc",
  });
  return result.data || [];
}

async function listAutomations() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const automationDir = path.join(codexHome, "automations");
  const entries = await fs.readdir(automationDir, { withFileTypes: true }).catch(() => []);
  const data = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const tomlPath = path.join(automationDir, entry.name, "automation.toml");
    const text = await fs.readFile(tomlPath, "utf8").catch(() => "");
    data.push({
      id: entry.name,
      name: extractTomlString(text, "name") || entry.name,
      status: extractTomlString(text, "status") || null,
      kind: extractTomlString(text, "kind") || null,
      prompt: extractTomlString(text, "prompt") || null,
    });
  }
  return { data };
}

function extractTomlString(text, key) {
  const match = String(text || "").match(new RegExp(`^${key}\\s*=\\s*"(.*)"\\s*$`, "m"));
  return match ? match[1].replace(/\\"/g, '"') : null;
}

function groupProjects(threads) {
  const byCwd = new Map();
  for (const thread of threads) {
    const cwd = thread.cwd || "Unknown";
    const project = byCwd.get(cwd) || {
      cwd,
      name: path.basename(cwd),
      latestUpdatedAt: thread.updatedAt || thread.createdAt || 0,
      threadCount: 0,
      recentThreads: [],
    };
    project.threadCount += 1;
    project.latestUpdatedAt = Math.max(project.latestUpdatedAt, thread.updatedAt || 0);
    if (project.recentThreads.length < 5) project.recentThreads.push(summarizeThread(thread));
    byCwd.set(cwd, project);
  }
  return [...byCwd.values()].sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt);
}

function summarizeThread(thread) {
  return {
    id: thread.id,
    title: thread.name || thread.title || thread.preview || "Untitled",
    cwd: thread.cwd,
    source: thread.source,
    status: thread.status,
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    gitInfo: thread.gitInfo,
  };
}

function normalizeThreadStartResult(result, fallbackCwd = null) {
  const candidates = [
    result?.thread,
    result?.data?.thread,
    result?.data,
    result,
  ];
  const thread = candidates.find((candidate) => candidate && typeof candidate === "object" && candidate.id);
  const threadId = thread?.id || result?.threadId || result?.data?.threadId || result?.data?.id || result?.id;
  if (!threadId) return null;
  return {
    ...(thread || {}),
    id: threadId,
    cwd: thread?.cwd || fallbackCwd || null,
  };
}

function mapApprovalDecision(decision, remember) {
  const mapped = decision === "allow" ? (remember ? "acceptForSession" : "accept") : decision === "cancel" ? "cancel" : "decline";
  return { decision: mapped };
}

function trackTurn(message) {
  const params = message.params || {};
  const threadId = extractThreadId(message);
  const turnId = params.turnId || params.turn?.id || params.item?.turnId || null;
  const itemId = params.itemId || params.item?.id || null;

  if (threadId && turnId) {
    rememberEventLookup(turnThreads, String(turnId), threadId);
  }
  if (threadId && itemId) {
    rememberEventLookup(itemThreads, String(itemId), threadId);
  }
  if (message.method === "turn/started" && threadId && turnId) {
    activeTurns.set(threadId, turnId);
  }
  if (message.method === "turn/completed" && threadId) {
    activeTurns.delete(threadId);
  }
  if (message.method === "turn/diff/updated" && threadId) {
    diffSnapshots.set(threadId, {
      turnId: params.turnId,
      diff: redact(params.diff || ""),
      updatedAt: Date.now(),
    });
  }
  if (message.method === "thread/tokenUsage/updated" && threadId) {
    tokenUsageSnapshots.set(threadId, {
      turnId: params.turnId || null,
      tokenUsage: params.tokenUsage || null,
      updatedAt: Date.now(),
    });
  }
}

function rememberEventLookup(map, key, value) {
  map.set(key, value);
  if (map.size <= EVENT_LOOKUP_MAX) return;
  const oldest = map.keys().next().value;
  if (oldest) map.delete(oldest);
}

function findActiveTurnId(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const status = String(turn?.status || "").toLowerCase();
    if (/(running|working|queued|pending|active)/.test(status)) return turn.id;
  }
  return null;
}

function extractThreadId(message) {
  const params = message.params || {};
  const directThreadId = params.threadId || params.thread?.id || params.item?.threadId || null;
  if (directThreadId) return directThreadId;
  const turnId = params.turnId || params.turn?.id || params.item?.turnId || null;
  if (turnId && turnThreads.has(String(turnId))) return turnThreads.get(String(turnId));
  const itemId = params.itemId || params.item?.id || null;
  if (itemId && itemThreads.has(String(itemId))) return itemThreads.get(String(itemId));
  return null;
}

function isAuthorized(req, url = null) {
  const auth = req.headers.authorization || "";
  const headerToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (isValidToken(headerToken)) {
    req._authToken = headerToken;
    return true;
  }
  const queryToken = url?.searchParams?.get("token");
  if (isValidToken(queryToken)) {
    req._authToken = queryToken;
    return true;
  }
  // Ticket-based auth for SSE: single-use, short-lived.
  const ticket = url?.searchParams?.get("ticket");
  if (ticket) {
    const entry = tickets.get(ticket);
    if (entry && entry.expiresAt > Date.now() && isValidToken(entry.userToken)) {
      tickets.delete(ticket);
      req._authToken = entry.userToken;
      return true;
    }
    if (entry) tickets.delete(ticket);
  }
  return false;
}

function isValidToken(token) {
  const session = token ? sessions.get(token) : null;
  if (!session) return false;
  const now = Date.now();
  if (session.expiresAt <= now) {
    sessions.delete(token);
    return false;
  }
  if (now - Number(session.lastSeenAt || 0) > SESSION_TOUCH_INTERVAL_MS) {
    session.lastSeenAt = now;
    session.expiresAt = now + SESSION_TTL_MS;
  }
  return true;
}

function getSessionForToken(token) {
  if (!token) return null;
  return sessions.get(token) || null;
}

function sweepExpiredTickets() {
  const now = Date.now();
  for (const [key, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(key);
  }
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isDesktopBrowserRequest(req) {
  if (!isLoopbackRequest(req)) return false;
  const hostname = String(req.headers.host || "").split(":")[0].replace(/^\[|\]$/g, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function readJson(req, options = {}) {
  const chunks = [];
  let total = 0;
  const maxBytes = options.maxBytes || 2 * 1024 * 1024;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveUploads(files) {
  if (!Array.isArray(files)) throw new Error("Invalid upload payload");
  if (files.length > 10) throw new Error("Upload at most 10 files at once");
  const dir = path.join(UPLOAD_ROOT, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  await fs.mkdir(dir, { recursive: true });
  let totalBytes = 0;
  const saved = [];
  for (const [index, file] of files.entries()) {
    const payload = decodeUploadData(file.data);
    totalBytes += payload.length;
    if (totalBytes > MAX_UPLOAD_BYTES) throw new Error("Attachments are too large");
    const name = sanitizeUploadName(file.name || `attachment-${index + 1}`);
    const diskName = `${String(index + 1).padStart(2, "0")}-${name}`;
    const target = path.join(dir, diskName);
    await fs.writeFile(target, payload);
    const id = crypto.randomUUID();
    const mime = String(file.mime || "application/octet-stream");
    const isImage = isImageAttachment(mime, name);
    if (isImage) {
      localPreviewFiles.set(id, {
        path: target,
        expiresAt: Date.now() + PREVIEW_TTL_MS,
      });
    }
    saved.push({
      id,
      name,
      path: target,
      mime,
      size: payload.length,
      isImage,
    });
  }
  return saved;
}

async function sendLocalImage(res, { previewId, filePath, cwd }) {
  const resolved = previewId
    ? resolveUploadPreviewPath(previewId)
    : resolveProjectImagePath(filePath, cwd);
  if (!resolved.ok) {
    sendJson(res, resolved.status, { error: resolved.error });
    return;
  }

  if (!isImageFile(resolved.path)) {
    sendJson(res, 415, { error: "Only local image previews are supported" });
    return;
  }
  const stat = await fs.stat(resolved.path).catch(() => null);
  if (!stat) {
    sendJson(res, 404, { error: "Image preview not found" });
    return;
  }
  if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES) {
    sendJson(res, 413, { error: "Image preview is too large" });
    return;
  }
  const data = await fs.readFile(resolved.path);
  res.writeHead(200, {
    "content-type": contentType(resolved.path),
    "cache-control": "private, max-age=300",
  });
  res.end(data);
}

function resolveUploadPreviewPath(previewId) {
  const preview = localPreviewFiles.get(String(previewId || ""));
  if (!preview || preview.expiresAt < Date.now()) {
    if (preview) localPreviewFiles.delete(String(previewId || ""));
    return { ok: false, status: 404, error: "Image preview not found" };
  }
  return { ok: true, path: path.resolve(preview.path) };
}

function resolveProjectImagePath(filePath, cwd) {
  if (!filePath || !cwd) return { ok: false, status: 400, error: "Missing image path" };
  const root = path.resolve(String(cwd));
  const candidate = String(filePath);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, status: 403, error: "Image path is outside the current project" };
  }
  return { ok: true, path: resolved };
}

function decodeUploadData(data) {
  if (typeof data !== "string") throw new Error("Missing upload data");
  const match = data.match(/^data:([^;]+);base64,(.*)$/s);
  const encoded = match ? match[2] : data;
  return Buffer.from(encoded, "base64");
}

function sanitizeUploadName(name) {
  const base = path.basename(String(name)).replace(/[^\w .()-]/g, "_").replace(/\s+/g, " ").trim();
  return base || "attachment";
}

function hasAttachments(attachments) {
  return Array.isArray(attachments) && attachments.some((attachment) => normalizeAttachment(attachment));
}

function hasMentions(mentions) {
  return Array.isArray(mentions) && mentions.some((mention) => mention?.kind || mention?.type);
}

function buildTurnInput(text, attachments = [], mentions = [], mentionRoot = null) {
  const input = [];
  const trimmed = String(text || "").trim();
  if (trimmed) input.push({ type: "text", text: trimmed });

  for (const mention of mentions || []) {
    const normalized = normalizeMention(mention, mentionRoot);
    if (!normalized) continue;
    input.push(normalized);
  }

  const fileNotes = [];
  for (const attachment of attachments || []) {
    const file = normalizeAttachment(attachment);
    if (!file) continue;
    if (file.isImage) {
      input.push({ type: "localImage", path: file.path });
      continue;
    }
    fileNotes.push(`- ${file.name}: ${file.path}`);
  }

  if (fileNotes.length) {
    input.push({
      type: "text",
      text: `Attached files on this computer:\n${fileNotes.join("\n")}`,
    });
  }
  return input;
}

function normalizeMention(mention, allowedRoot) {
  const kind = String(mention?.kind || mention?.type || "").toLowerCase();
  if (kind === "skill") {
    const name = String(mention.name || "").trim();
    if (!name) return null;
    return { type: "skill", name, path: String(mention.path || mention.source || "") };
  }
  if (kind !== "file" && kind !== "mention") return null;
  const rawPath = String(mention.path || mention.absolutePath || "").trim();
  if (!rawPath) return null;
  const resolved = path.resolve(rawPath);
  const root = path.resolve(allowedRoot || mention.root || path.dirname(resolved));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  return {
    type: "mention",
    name: sanitizeUploadName(mention.name || path.basename(resolved)),
    path: resolved,
  };
}

async function searchMentions(cwd, query) {
  const roots = cwd ? [cwd] : [];
  const [files, agents, plugins, apps] = await Promise.all([
    roots.length
      ? rpc.request("fuzzyFileSearch", { query, roots, cancellationToken: null })
        .catch((error) => ({ error: cleanCommandOutput(error.message || error), files: [] }))
      : Promise.resolve({ files: [] }),
    listLocalAgents(query),
    cachedResponse(`mention-plugins:${cwd || ""}`, () => rpc.request("plugin/list", { cwds: roots.length ? roots : null })
      .catch((error) => ({ error: cleanCommandOutput(error.message || error), marketplaces: [] }))),
    cachedResponse("mention-apps", () => rpc.request("app/list", { limit: 100 })
      .catch((error) => ({ error: cleanCommandOutput(error.message || error), data: [] }))),
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const filterText = (value) => !normalizedQuery || String(value || "").toLowerCase().includes(normalizedQuery);
  const flattenedPlugins = collectPlugins(plugins)
    .filter((plugin) => filterText(`${plugin.name || ""} ${plugin.interface?.displayName || ""} ${plugin.interface?.description || ""}`))
    .slice(0, 8);
  const summarizedApps = summarizeApps(apps).data
    .filter((app) => filterText(`${app.name || ""} ${app.description || ""}`))
    .slice(0, 8);

  return {
    files: (files.files || []).slice(0, 12).map((file) => ({
      root: file.root,
      path: file.path,
      absolutePath: path.join(file.root, file.path),
      name: file.file_name || path.basename(file.path),
      matchType: file.match_type,
      score: file.score,
    })),
    agents,
    plugins: flattenedPlugins.map((plugin) => ({
      id: plugin.id || plugin.name,
      name: plugin.name || plugin.id,
      displayName: plugin.interface?.displayName || plugin.displayName || plugin.name || plugin.id,
      description: plugin.interface?.description || plugin.description || null,
    })),
    apps: summarizedApps,
  };
}

async function listLocalAgents(query = "") {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const candidates = [
    path.join(codexHome, "agents"),
    path.join(os.homedir(), ".agents", "agents"),
  ];
  const agents = [];
  for (const dir of candidates) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
      const filePath = path.join(dir, entry.name);
      const text = await fs.readFile(filePath, "utf8").catch(() => "");
      const name = extractTomlString(text, "name") || entry.name.replace(/\.toml$/, "");
      const description = extractTomlString(text, "description") || "";
      const model = extractTomlString(text, "model") || "";
      agents.push({ name, description, model, path: filePath });
    }
  }
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return agents
    .filter((agent) => !normalizedQuery || `${agent.name} ${agent.description}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12);
}

function collectPlugins(plugins) {
  return (plugins?.marketplaces || []).flatMap((marketplace) => marketplace.plugins || []);
}

function normalizeAttachment(attachment) {
  if (!attachment?.path) return null;
  const resolved = path.resolve(String(attachment.path));
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  const name = sanitizeUploadName(attachment.name || path.basename(resolved));
  const mime = String(attachment.mime || "");
  return {
    name,
    path: resolved,
    mime,
    isImage: Boolean(attachment.isImage) || isImageAttachment(mime, name),
  };
}

function isImageAttachment(mime, name) {
  return String(mime || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif|svg)$/i.test(String(name || ""));
}

function isImageFile(filePath) {
  return /\.(png|jpe?g|gif|webp|heic|heif|svg)$/i.test(String(filePath || ""));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

const PWA_FILES = new Set(["/sw.js", "/manifest.webmanifest", "/registerSW.js"]);

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

async function directoryExists(dir) {
  return fs.stat(dir).then((stat) => stat.isDirectory()).catch(() => false);
}

function contentType(file) {
  const lower = String(file || "").toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heic";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  return "application/octet-stream";
}

function handleSseEvents(req, res, url) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // disables proxy buffering (nginx, cloudflared) so chunks flush immediately
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  res.socket?.setKeepAlive?.(true);
  // Hint to EventSource: retry after 3s if disconnected
  res.write("retry: 3000\n\n");
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const sessionToken = req._authToken || null;
  const session = getSessionForToken(sessionToken);
  const threadFilterRaw = url?.searchParams?.get("thread") || "";
  const threadFilter = threadFilterRaw ? String(threadFilterRaw) : null;
  const client = {
    res,
    lastWriteAt: Date.now(),
    threadFilter,
    sessionToken,
    sessionExpiresAt: session?.expiresAt || null,
  };
  sseClients.add(client);

  // Replay buffered events after Last-Event-ID. Accepts both the standard
  // request header (used by EventSource on auto-retry) and a `?lastEventId=`
  // URL param (used by the client on FRESH connect after a snapshot fetch,
  // since EventSource has no API to seed Last-Event-ID for the first request).
  const lastEventIdHeader = req.headers["last-event-id"];
  const lastEventIdQuery = url.searchParams.get("lastEventId");
  const lastEventIdRaw = lastEventIdHeader || lastEventIdQuery;
  const lastSeenId = lastEventIdRaw ? Number(lastEventIdRaw) : NaN;
  if (Number.isFinite(lastSeenId) && lastSeenId > 0) {
    for (const buffered of sseEventBuffer) {
      if (buffered.id <= lastSeenId) continue;
      if (clientShouldReceive(client, buffered.message)) {
        try {
          client.res.write(buffered.line);
          client.lastWriteAt = Date.now();
        } catch {
          sseClients.delete(client);
          try { res.end(); } catch {}
          return;
        }
      }
    }
  }

  const cleanup = () => {
    if (!sseClients.has(client)) return;
    sseClients.delete(client);
    try { res.end(); } catch {}
    if (sseClients.size === 0 && sseHeartbeatTimer) {
      clearInterval(sseHeartbeatTimer);
      sseHeartbeatTimer = null;
    }
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
  res.on("error", cleanup);
  res.on("close", cleanup);

  if (!sseHeartbeatTimer) startSseHeartbeat();
  if (!ticketSweepTimer) startTicketSweep();
}

function startSseHeartbeat() {
  sseHeartbeatTimer = setInterval(() => {
    pushEvent({ type: "heartbeat", ts: Date.now() });
  }, SSE_HEARTBEAT_MS);
  if (typeof sseHeartbeatTimer.unref === "function") sseHeartbeatTimer.unref();
}

function startTicketSweep() {
  ticketSweepTimer = setInterval(sweepExpiredTickets, TICKET_SWEEP_MS);
  if (typeof ticketSweepTimer.unref === "function") ticketSweepTimer.unref();
}

function clientShouldReceive(client, message) {
  if (!client.threadFilter) return true;
  // Heartbeats and connection-level events have no threadId; deliver to all.
  if (!message || message.type === "heartbeat" || message.type === "connected") return true;
  if (!message.threadId) return true;
  return String(message.threadId) === client.threadFilter;
}

function pushEvent(message) {
  sseEventCounter += 1;
  const id = sseEventCounter;
  const line = `id: ${id}\ndata: ${JSON.stringify(message)}\n\n`;
  sseEventBuffer.push({ id, line, message });
  if (sseEventBuffer.length > SSE_BUFFER_MAX) sseEventBuffer.shift();
  if (sseClients.size === 0) return;
  const now = Date.now();
  for (const client of sseClients) {
    if (client.sessionExpiresAt && client.sessionExpiresAt < now) {
      sseClients.delete(client);
      try { client.res.end(); } catch {}
      continue;
    }
    if (!clientShouldReceive(client, message)) continue;
    try {
      client.res.write(line);
      client.lastWriteAt = now;
    } catch {
      sseClients.delete(client);
      try { client.res.end(); } catch {}
    }
  }
}

function broadcast(message) {
  pushEvent(message);
}

function getLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

function getPublicBaseUrl() {
  if (publicBaseUrlOverride) return publicBaseUrlOverride;
  const address = host === "0.0.0.0" ? getLanAddress() : host;
  return `http://${address}:${port}`;
}

function normalizePublicUrl(value) {
  const text = String(value || "").trim().replace(/\/$/, "");
  const parsed = new URL(text);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Public URL must be http or https");
  return parsed.toString().replace(/\/$/, "");
}

function summarizeConfig(config) {
  const profile = config.profile && config.profiles?.[config.profile] ? config.profiles[config.profile] : {};
  const pick = (key) => profile?.[key] ?? config?.[key] ?? null;
  return {
    profile: config.profile || null,
    model: pick("model"),
    modelProvider: pick("model_provider"),
    effort: pick("model_reasoning_effort"),
    summary: pick("model_reasoning_summary"),
    approvalPolicy: pick("approval_policy"),
    approvalsReviewer: pick("approvals_reviewer"),
    modelContextWindow: pick("model_context_window"),
    modelAutoCompactTokenLimit: pick("model_auto_compact_token_limit"),
    sandboxMode: config.sandbox_mode || null,
    sandboxWorkspaceWrite: config.sandbox_workspace_write || null,
  };
}

function summarizeRequirements(requirements) {
  if (requirements?.error) return requirements;
  return {
    required: requirements?.required || requirements?.data || [],
    satisfied: requirements?.satisfied ?? requirements?.ok ?? null,
  };
}

function summarizePlugins(plugins) {
  if (plugins?.error) return { error: plugins.error, marketplaces: [] };
  return {
    marketplaces: (plugins?.marketplaces || []).map((marketplace) => ({
      id: marketplace.id || marketplace.name || null,
      name: marketplace.name || marketplace.displayName || "Marketplace",
      displayName: marketplace.displayName || marketplace.name || "Marketplace",
      plugins: (marketplace.plugins || []).map((plugin) => ({
        id: plugin.id || plugin.name || null,
        name: plugin.name || plugin.id || "Plugin",
        installed: Boolean(plugin.installed),
        enabled: plugin.enabled ?? plugin.isEnabled ?? null,
        installPolicy: plugin.installPolicy || null,
        category: plugin.category || plugin.interface?.category || null,
        interface: {
          displayName: plugin.interface?.displayName || plugin.displayName || plugin.name || plugin.id || "Plugin",
          description: plugin.interface?.description || plugin.description || plugin.shortDescription || null,
        },
      })),
    })),
    marketplaceLoadErrors: plugins?.marketplaceLoadErrors || [],
    featuredPluginIds: plugins?.featuredPluginIds || [],
  };
}

function summarizeSkills(skills) {
  if (skills?.error) return { error: skills.error, data: [] };
  return {
    data: (skills?.data || []).map((entry) => ({
      cwd: entry.cwd || null,
      skills: (entry.skills || []).map((skill) => ({
        name: skill.name || skill.metadata?.name || null,
        description: skill.description || skill.metadata?.description || null,
        source: skill.source || skill.metadata?.source || null,
        enabled: skill.enabled ?? skill.metadata?.enabled ?? null,
      })),
    })),
  };
}

function flattenSkills(skills) {
  const seen = new Set();
  const entries = [];
  for (const entry of skills?.data || []) {
    for (const skill of entry.skills || []) {
      const name = skill.name || skill.metadata?.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      entries.push({
        name,
        description: skill.description || skill.metadata?.description || null,
        source: skill.source || skill.metadata?.source || null,
        enabled: skill.enabled ?? skill.metadata?.enabled ?? null,
      });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function summarizeApps(apps) {
  if (apps?.error) return { error: apps.error, data: [] };
  return {
    data: (apps?.data || []).map((app) => ({
      id: app.id || app.name || null,
      name: app.name || app.displayName || app.id || "App",
      description: app.description || app.shortDescription || null,
      category: app.category || null,
      isEnabled: app.isEnabled ?? app.enabled ?? null,
      isAccessible: app.isAccessible ?? null,
      developer: app.developer || app.author || null,
    })),
    nextCursor: apps?.nextCursor || null,
  };
}

function summarizeMcpServers(mcpServers) {
  if (mcpServers?.error) return { error: mcpServers.error, mcpServers: [] };
  const data = mcpServers?.mcpServers || mcpServers?.data || [];
  return {
    mcpServers: data.map((server) => ({
      id: server.id || server.name || server.serverName || null,
      name: server.name || server.serverName || server.id || "MCP Server",
      status: server.status || server.state || null,
      error: server.error || null,
      toolCount: Array.isArray(server.tools) ? server.tools.length : server.toolCount ?? null,
      auth: server.auth ? {
        status: server.auth.status || server.auth.state || null,
        type: server.auth.type || null,
      } : null,
    })),
  };
}

function summarizeFeatures(features) {
  if (features?.error) return { error: features.error, data: [] };
  return {
    data: (features?.data || []).map((feature) => ({
      name: feature.name || feature.id || null,
      displayName: feature.displayName || feature.name || feature.id || "Feature",
      enabled: feature.enabled ?? feature.isEnabled ?? null,
      defaultEnabled: feature.defaultEnabled ?? null,
      stage: feature.stage || feature.status || null,
    })),
  };
}

async function getGitContext(cwd) {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]).catch(() => "");
  if (!root) return { ok: false, cwd, error: "Not a git repository" };
  const [branch, sha, status] = await Promise.all([
    git(cwd, ["branch", "--show-current"]).catch(() => ""),
    git(cwd, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]).catch(() => ""),
  ]);
  return {
    ok: true,
    cwd,
    root,
    branch: branch || "detached",
    sha: sha || null,
    dirty: Boolean(status),
    statusCount: parseGitStatus(status).length,
  };
}

async function getGitBranches(cwd) {
  const context = await getGitContext(cwd);
  if (!context.ok) return { ...context, current: null, branches: [] };
  const output = await git(cwd, ["branch", "--format=%(refname:short)\t%(upstream:short)\t%(committerdate:unix)", "--sort=-committerdate"]).catch(() => "");
  const branches = output.split("\n").filter(Boolean).map((line) => {
    const [name, upstream, updatedAt] = line.split("\t");
    return {
      name,
      upstream: upstream || null,
      updatedAt: updatedAt ? Number(updatedAt) : null,
      current: name === context.branch,
    };
  });
  if (!branches.length && context.branch && context.branch !== "detached") {
    branches.push({ name: context.branch, upstream: null, updatedAt: null, current: true });
  }
  return { ...context, current: context.branch, branches };
}

async function checkoutGitBranch(cwd, branch, create) {
  const name = String(branch || "").trim();
  if (!name) throw new Error("Missing branch name");
  await validateBranchName(cwd, name, create);
  const args = create ? ["checkout", "-b", name] : ["checkout", name];
  const output = await git(cwd, args);
  const context = await getGitContext(cwd);
  return { ok: true, output, ...context };
}

async function commitGitChanges(cwd, message, stageAll) {
  const text = String(message || "").trim();
  if (!text) throw new Error("Missing commit message");
  const context = await getGitContext(cwd);
  if (!context.ok) return context;
  if (stageAll) await git(cwd, ["add", "-A"]);
  const output = await git(cwd, ["commit", "-m", text]);
  const next = await getGitContext(cwd);
  return { ok: true, output, ...next };
}

async function validateBranchName(cwd, branch, create) {
  const args = create ? ["check-ref-format", "--branch", branch] : ["rev-parse", "--verify", "--quiet", branch];
  try {
    await git(cwd, args);
  } catch {
    throw new Error(create ? "Invalid branch name" : "Branch not found");
  }
}

async function getGitChanges(cwd) {
  const context = await getGitContext(cwd);
  if (!context.ok) {
    const workspace = await getWorkspaceGitChanges(cwd, context).catch(() => null);
    if (workspace) return workspace;
    return { ...context, canCommit: false, summary: { filesChanged: 0, additions: 0, deletions: 0 }, files: [] };
  }
  return getSingleRepoGitChanges(cwd, context);
}

async function getSingleRepoGitChanges(cwd, context, options = {}) {
  const [statusText, diffStat, cachedStat] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(cwd, ["diff", "--numstat"]).catch(() => ""),
    git(cwd, ["diff", "--cached", "--numstat"]).catch(() => ""),
  ]);
  const files = mergeGitStats(parseGitStatus(statusText), parseNumstat(`${diffStat}\n${cachedStat}`));
  const enrichedFiles = await Promise.all(files.slice(0, MAX_CHANGE_FILES).map((file) => addFileDiff(cwd, file)));
  const summary = files.reduce((acc, file) => {
    acc.filesChanged += 1;
    acc.additions += Number(file.additions || 0);
    acc.deletions += Number(file.deletions || 0);
    return acc;
  }, { filesChanged: 0, additions: 0, deletions: 0 });

  return {
    ...context,
    canCommit: true,
    summary,
    files: enrichedFiles.map((file) => ({
      ...file,
      repo: options.repoName || path.basename(context.root || cwd),
      repoRoot: context.root || cwd,
      repoPath: options.repoPath || ".",
    })),
    truncatedFiles: files.length > enrichedFiles.length ? files.length - enrichedFiles.length : 0,
  };
}

async function getWorkspaceGitChanges(cwd, baseContext) {
  const repos = await findNestedGitRepositories(cwd);
  if (!repos.length) return null;

  const repositoryResults = [];
  for (const repoRoot of repos.slice(0, MAX_WORKSPACE_GIT_REPOS)) {
    const context = await getGitContext(repoRoot).catch(() => null);
    if (!context?.ok) continue;
    const repoPath = path.relative(cwd, repoRoot) || ".";
    const repoChanges = await getSingleRepoGitChanges(repoRoot, context, {
      repoName: path.basename(repoRoot),
      repoPath,
    }).catch(() => null);
    if (!repoChanges || !repoChanges.summary.filesChanged) continue;
    repositoryResults.push(repoChanges);
  }

  const summary = repositoryResults.reduce((acc, repo) => {
    acc.filesChanged += repo.summary.filesChanged || 0;
    acc.additions += repo.summary.additions || 0;
    acc.deletions += repo.summary.deletions || 0;
    return acc;
  }, { filesChanged: 0, additions: 0, deletions: 0 });

  const files = repositoryResults.flatMap((repo) => repo.files.map((file) => ({
    ...file,
    displayPath: file.repoPath && file.repoPath !== "." ? `${file.repoPath}/${file.path}` : file.path,
  })));

  return {
    ok: true,
    workspace: true,
    canCommit: false,
    cwd,
    root: cwd,
    branch: repositoryResults.length ? `${repositoryResults.length} dirty repos` : "workspace",
    sha: null,
    dirty: Boolean(summary.filesChanged),
    statusCount: summary.filesChanged,
    summary,
    files,
    repositories: repositoryResults.map((repo) => ({
      root: repo.root,
      repo: path.basename(repo.root),
      repoPath: path.relative(cwd, repo.root) || ".",
      branch: repo.branch,
      sha: repo.sha,
      summary: repo.summary,
      truncatedFiles: repo.truncatedFiles || 0,
    })),
    truncatedRepositories: repos.length > MAX_WORKSPACE_GIT_REPOS ? repos.length - MAX_WORKSPACE_GIT_REPOS : 0,
    sourceError: baseContext.error || null,
  };
}

async function findNestedGitRepositories(cwd) {
  const root = path.resolve(String(cwd || ""));
  if (!root) return [];
  const repos = [];

  async function walk(dir, depth) {
    if (repos.length >= MAX_WORKSPACE_GIT_REPOS) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.name === ".git")) {
      repos.push(dir);
      return;
    }
    if (depth >= WORKSPACE_GIT_SCAN_DEPTH) return;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (GIT_SCAN_SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".config") continue;
      await walk(path.join(dir, entry.name), depth + 1);
      if (repos.length >= MAX_WORKSPACE_GIT_REPOS) return;
    }
  }

  await walk(root, 0);
  return repos.sort((a, b) => a.localeCompare(b));
}

async function addFileDiff(cwd, file) {
  if (file.status.includes("?")) {
    const additions = await countTextLines(path.join(cwd, file.path)).catch(() => null);
    const diff = await buildUntrackedFileDiff(cwd, file.path).catch(() => "");
    return {
      ...file,
      additions,
      deletions: 0,
      diff,
      binary: additions == null && !diff,
      diffUnavailableReason: diff ? "" : "untracked file is binary, too large, or unreadable",
    };
  }
  const args = ["diff", "--", file.path];
  const cachedArgs = ["diff", "--cached", "--", file.path];
  const [unstaged, staged] = await Promise.all([
    git(cwd, args).catch(() => ""),
    git(cwd, cachedArgs).catch(() => ""),
  ]);
  const diff = `${staged ? `${staged}\n` : ""}${unstaged}`.trim();
  return {
    ...file,
    diff: diff.length > MAX_CHANGE_DIFF_BYTES ? `${diff.slice(0, MAX_CHANGE_DIFF_BYTES)}\n\n... diff truncated ...` : diff,
    truncatedDiff: diff.length > MAX_CHANGE_DIFF_BYTES,
  };
}

async function buildUntrackedFileDiff(cwd, filePath) {
  const absolute = path.join(cwd, filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > MAX_CHANGE_DIFF_BYTES) return "";
  const content = await fs.readFile(absolute, "utf8");
  if (content.includes("\u0000")) return "";
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const lines = normalized.split("\n");
  const body = lines
    .slice(0, -1)
    .map((line) => `+${line}`)
    .join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length - 1} @@`,
    body,
  ].join("\n");
}

function parseGitStatus(statusText) {
  return String(statusText || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      const rawPath = line.slice(3);
      const pathName = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
      return {
        path: unquoteGitPath(pathName),
        status,
        staged: status[0] !== " " && status[0] !== "?",
        unstaged: status[1] !== " " || status[0] === "?",
        additions: null,
        deletions: null,
        diff: "",
      };
    });
}

function parseNumstat(text) {
  const stats = new Map();
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    const [additions, deletions, filePath] = line.split("\t");
    if (!filePath) continue;
    const normalized = unquoteGitPath(filePath.includes(" => ") ? filePath.split(" => ").at(-1).replace(/[{}]/g, "") : filePath);
    const current = stats.get(normalized) || { additions: 0, deletions: 0 };
    current.additions += additions === "-" ? 0 : Number(additions || 0);
    current.deletions += deletions === "-" ? 0 : Number(deletions || 0);
    stats.set(normalized, current);
  }
  return stats;
}

function mergeGitStats(statusFiles, numstats) {
  const byPath = new Map(statusFiles.map((file) => [file.path, { ...file }]));
  for (const [filePath, stat] of numstats.entries()) {
    const file = byPath.get(filePath) || {
      path: filePath,
      status: " M",
      staged: false,
      unstaged: true,
      diff: "",
    };
    file.additions = stat.additions;
    file.deletions = stat.deletions;
    byPath.set(filePath, file);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function unquoteGitPath(value) {
  const text = String(value || "");
  if (!text.startsWith('"')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(1, -1);
  }
}

async function git(cwd, args) {
  const result = await execFile("git", args, {
    cwd,
    timeout: 8000,
    maxBuffer: 1_000_000,
  });
  return cleanCommandOutput(`${result.stdout}${result.stderr}`);
}

async function countTextLines(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 500_000) return null;
  const content = await fs.readFile(filePath, "utf8");
  if (content.includes("\u0000")) return null;
  if (!content) return 0;
  return content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length;
}
