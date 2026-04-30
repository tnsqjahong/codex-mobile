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
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const rpc = new CodexRpc();
const wsClients = new Set();
const pairings = new Map();
const sessions = new Map();
const activeTurns = new Map();
const diffSnapshots = new Map();
const tokenUsageSnapshots = new Map();
const responseCache = new Map();
const CACHE_TTL_MS = 120_000;
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/events") {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get("token");
  if (!isValidToken(token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  upgradeWebSocket(req, socket);
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
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, { error: "Public URL can only be updated from this computer" });
      return;
    }
    const body = await readJson(req);
    publicBaseUrlOverride = normalizePublicUrl(body.publicUrl);
    sendJson(res, 200, { publicUrl: publicBaseUrlOverride });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/desktop/login/start") {
    if (!isLoopbackRequest(req)) {
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
    if (!isLoopbackRequest(req)) {
      sendJson(res, 403, { error: "Desktop login can only be cancelled from this computer" });
      return;
    }
    cancelDesktopLogin();
    sendJson(res, 200, getPublicLoginFlow());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pair/start") {
    if (!isLoopbackRequest(req)) {
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
    ensureAppServerStarted().catch((error) => {
      console.warn(`Failed to prewarm Codex app-server: ${error.message || error}`);
    });
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const expiresAt = Date.now() + 60_000;
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
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    sessions.set(token, { deviceName: body.deviceName || "Mobile", expiresAt });
    sendJson(res, 200, { accessToken: token, expiresAt });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: "Unauthorized" });
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
    const threadId = result.thread?.id;
    if (threadId && body.text?.trim()) {
      const turnParams = {
        threadId,
        input: [{ type: "text", text: body.text }],
      };
      if (body.model) turnParams.model = String(body.model);
      if (body.effort) turnParams.effort = String(body.effort);
      await rpc.request("turn/start", turnParams);
    }
    sendJson(res, 200, result);
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

  const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
  if (req.method === "GET" && threadMatch) {
    await ensureAppServerStarted();
    const result = await rpc.request("thread/read", {
      threadId: decodeURIComponent(threadMatch[1]),
      includeTurns: true,
    });
    sendJson(res, 200, result);
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
    if (!body.text?.trim()) {
      sendJson(res, 400, { error: "Missing text" });
      return;
    }
    await rpc.request("thread/resume", { threadId });
    const params = {
      threadId,
      input: [{ type: "text", text: body.text }],
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
    const turnId = body.turnId || activeTurns.get(threadId);
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

function mapApprovalDecision(decision, remember) {
  const mapped = decision === "allow" ? (remember ? "acceptForSession" : "accept") : decision === "cancel" ? "cancel" : "decline";
  return { decision: mapped };
}

function trackTurn(message) {
  const params = message.params || {};
  if (message.method === "turn/started" && params.threadId && params.turn?.id) {
    activeTurns.set(params.threadId, params.turn.id);
  }
  if (message.method === "turn/completed" && params.threadId) {
    activeTurns.delete(params.threadId);
  }
  if (message.method === "turn/diff/updated" && params.threadId) {
    diffSnapshots.set(params.threadId, {
      turnId: params.turnId,
      diff: redact(params.diff || ""),
      updatedAt: Date.now(),
    });
  }
  if (message.method === "thread/tokenUsage/updated" && params.threadId) {
    tokenUsageSnapshots.set(params.threadId, {
      turnId: params.turnId || null,
      tokenUsage: params.tokenUsage || null,
      updatedAt: Date.now(),
    });
  }
}

function extractThreadId(message) {
  const params = message.params || {};
  return params.threadId || params.thread?.id || params.item?.threadId || null;
}

function isAuthorized(req) {
  const auth = req.headers.authorization || "";
  return isValidToken(auth.startsWith("Bearer ") ? auth.slice(7) : null);
}

function isValidToken(token) {
  const session = token ? sessions.get(token) : null;
  return Boolean(session && session.expiresAt > Date.now());
}

function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.normalize(path.join(publicDir, pathname));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { "content-type": contentType(target) });
    res.end(data);
  } catch {
    const data = await fs.readFile(path.join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function upgradeWebSocket(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );

  const client = { socket, subscriptions: new Set() };
  wsClients.add(client);
  socket.on("data", (buffer) => handleWsData(client, buffer));
  socket.on("close", () => wsClients.delete(client));
  socket.on("error", () => wsClients.delete(client));
  wsSend(client, { type: "connected" });
}

function handleWsData(client, buffer) {
  const messages = decodeWsFrames(buffer);
  for (const text of messages) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      continue;
    }
    if (message.type === "subscribeThread" && message.threadId) {
      client.subscriptions.add(message.threadId);
    }
    if (message.type === "unsubscribeThread" && message.threadId) {
      client.subscriptions.delete(message.threadId);
    }
  }
}

function broadcast(message) {
  for (const client of wsClients) {
    if (message.threadId && client.subscriptions.size && !client.subscriptions.has(message.threadId)) continue;
    wsSend(client, message);
  }
}

function wsSend(client, value) {
  const payload = Buffer.from(JSON.stringify(value));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  client.socket.write(Buffer.concat([header, payload]));
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset++];
    const second = buffer[offset++];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    if (length === 126) {
      length = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }
    const mask = masked ? buffer.subarray(offset, offset + 4) : null;
    if (masked) offset += 4;
    const payload = buffer.subarray(offset, offset + length);
    offset += length;
    if (opcode === 8) break;
    if (opcode !== 1) continue;
    const unmasked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) {
      unmasked[i] = masked ? payload[i] ^ mask[i % 4] : payload[i];
    }
    frames.push(unmasked.toString("utf8"));
  }
  return frames;
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
    return { ...context, summary: { filesChanged: 0, additions: 0, deletions: 0 }, files: [] };
  }

  const [statusText, diffStat, cachedStat] = await Promise.all([
    git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]),
    git(cwd, ["diff", "--numstat"]).catch(() => ""),
    git(cwd, ["diff", "--cached", "--numstat"]).catch(() => ""),
  ]);
  const files = mergeGitStats(parseGitStatus(statusText), parseNumstat(`${diffStat}\n${cachedStat}`));
  const enrichedFiles = await Promise.all(files.slice(0, 80).map((file) => addFileDiff(cwd, file)));
  const summary = enrichedFiles.reduce((acc, file) => {
    acc.filesChanged += 1;
    acc.additions += Number(file.additions || 0);
    acc.deletions += Number(file.deletions || 0);
    return acc;
  }, { filesChanged: 0, additions: 0, deletions: 0 });

  return { ...context, summary, files: enrichedFiles };
}

async function addFileDiff(cwd, file) {
  if (file.status.includes("?")) {
    const additions = await countTextLines(path.join(cwd, file.path)).catch(() => null);
    return { ...file, additions, deletions: 0, diff: "" };
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
    diff: diff.length > 80_000 ? `${diff.slice(0, 80_000)}\n\n... diff truncated ...` : diff,
  };
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
