#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { detectFunnelUrl } from "../src/bridge/tailscale.js";

const execFile = promisify(execFileCallback);
const entryFile = fileURLToPath(import.meta.url);
const __dirname = path.dirname(entryFile);
const rootDir = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const port = Number(process.env.PORT || 8787);
const localMode = args.includes("--local");
const openBrowser = !args.includes("--no-open");
const backgroundMode = args.includes("--background");
const desktopUrl = `http://127.0.0.1:${port}`;
const localLanUrl = `http://${getLanAddress()}:${port}`;
const targetUrl = `http://127.0.0.1:${port}`;
const children = [];
let publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") || null;
let tunnel = null;

if (args.includes("--help")) {
  console.log("Usage: codex-mobile [--background] [--foreground] [--no-open] [--local]");
  process.exit(0);
}

if (backgroundMode && process.env.CODEX_MOBILE_FOREGROUND !== "1") {
  await startBackgroundCompanion();
  process.exit(0);
}

const bridgeWasRunning = await isBridgeRunning();
if (!bridgeWasRunning) {
  const bridge = startBridge();
  children.push(bridge);
  await waitForBridge(bridge);
}

if (!publicUrl && !localMode) {
  const funnelUrl = await withTimeout(detectFunnelUrl(port), 1500).catch(() => null);
  if (funnelUrl) {
    console.log(`Using Tailscale Funnel: ${funnelUrl}`);
    publicUrl = funnelUrl;
  } else {
    tunnel = await startRemoteTunnel(targetUrl).catch((error) => {
      console.warn(`Remote tunnel failed: ${error.message}`);
      return null;
    });
    publicUrl = tunnel?.url || localLanUrl;
  }
} else if (!publicUrl) {
  publicUrl = localLanUrl;
}

await setPublicUrl(publicUrl);

console.log(`${bridgeWasRunning ? "Codex Mobile Companion already running" : "Codex Mobile Companion running"} on ${desktopUrl}`);
console.log(`Mobile QR will point to: ${publicUrl}`);
if (!tunnel && !localMode && !process.env.PUBLIC_URL) {
  console.log("Remote tunnel unavailable; QR is LAN-only until the tunnel can start.");
}
if (openBrowser) await openUrl(desktopUrl);

if (bridgeWasRunning && !tunnel) process.exit(0);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function startBridge() {
  const host = process.env.HOST || (localMode ? "0.0.0.0" : "127.0.0.1");
  const child = spawn(process.execPath, [path.join(rootDir, "src/bridge/server.js")], {
    cwd: rootDir,
    env: { ...process.env, HOST: host, PORT: String(port), PUBLIC_URL: publicUrl || targetUrl },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (!process.exitCode) process.exitCode = code ?? (signal ? 1 : 0);
  });
  return child;
}

async function startBackgroundCompanion() {
  const runningHealth = await getBridgeHealth();
  const runningUrl = runningHealth?.bridgeUrl || "";
  const hasStablePublicUrl = runningUrl && runningUrl !== targetUrl;
  const runningUrlReady = publicUrl || localMode || hasStablePublicUrl;
  if (runningHealth?.ok && runningUrlReady) {
    if (publicUrl) await setPublicUrl(publicUrl).catch(() => {});
    if (openBrowser) await openUrl(desktopUrl);
    printReadyUrls("already running", publicUrl || runningUrl || desktopUrl);
    return;
  }
  const childArgs = [
    entryFile,
    ...args.filter((arg) => arg !== "--background"),
    "--no-open",
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: rootDir,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, CODEX_MOBILE_FOREGROUND: "1" },
  });
  child.unref();
  await waitForBridge(child);
  const mobileUrl = await waitForMobileUrl(child, runningUrl);
  if (openBrowser) await openUrl(desktopUrl);
  printReadyUrls("running in background", mobileUrl || desktopUrl);
}

async function startRemoteTunnel(target) {
  const command = await resolveTunnelCommand();
  console.log("Starting secure remote tunnel...");
  const child = spawn(command.command, [...command.args, "tunnel", "--url", target], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out waiting for tunnel URL"));
    }, 30_000);
    const handleData = (chunk) => {
      const text = chunk.toString("utf8");
      output = `${output}${text}`.slice(-6000);
      const match = text.match(/https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com/);
      if (!match || settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ child, url: match[0] });
    };
    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Tunnel exited before URL was ready (${code}). ${output.trim()}`));
    });
  });
}

async function resolveTunnelCommand() {
  if (await commandExists("cloudflared")) return { command: "cloudflared", args: ["--config", "/dev/null"] };
  if (await commandExists("npx")) return { command: "npx", args: ["--yes", "cloudflared", "--config", "/dev/null"] };
  throw new Error("cloudflared or npx is required for remote access");
}

async function commandExists(command) {
  try {
    await execFile(command, ["--version"], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function setPublicUrl(url) {
  await postJson(`${desktopUrl}/api/desktop/public-url`, { publicUrl: url }, 1500).catch((error) => {
    throw new Error(`Failed to set QR URL: ${error.message}`);
  });
}

function getLanAddress() {
  const preferredNames = ["en0", "en1", "eth0", "wlan0"];
  const interfaces = os.networkInterfaces();
  for (const name of preferredNames) {
    const address = firstUsableAddress(interfaces[name]);
    if (address) return address;
  }
  for (const [name, entries] of Object.entries(interfaces)) {
    if (/^(utun|awdl|llw|lo|bridge|feth)/.test(name)) continue;
    const address = firstUsableAddress(entries);
    if (address) return address;
  }
  return "127.0.0.1";
}

function firstUsableAddress(entries = []) {
  return entries.find((entry) => entry.family === "IPv4" && !entry.internal)?.address || null;
}

async function isBridgeRunning() {
  return Boolean(await getBridgeHealth());
}

async function getBridgeHealth() {
  try {
    const health = await requestJson(`${desktopUrl}/api/health`, 600);
    return health?.ok ? health : null;
  } catch {
    return null;
  }
}

async function waitForBridge(child = null) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await isBridgeRunning()) return;
    if (child?.exitCode !== null) {
      throw new Error(`Codex Mobile Companion exited before it could start (exit ${child.exitCode})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error("Timed out waiting for Codex Mobile Companion to start");
}

async function waitForMobileUrl(child = null, previousUrl = "") {
  if (publicUrl) return publicUrl;
  if (localMode) {
    const health = await getBridgeHealth();
    return health?.bridgeUrl || localLanUrl;
  }
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const health = await getBridgeHealth();
    const bridgeUrl = health?.bridgeUrl || "";
    if (bridgeUrl && bridgeUrl !== targetUrl && bridgeUrl !== previousUrl) return bridgeUrl;
    if (child?.exitCode !== null) {
      throw new Error("Codex Mobile Companion exited before it published a mobile URL");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Timed out waiting for mobile QR URL");
}

function printReadyUrls(status, mobileUrl) {
  console.log(`Codex Mobile Companion ${status}`);
  console.log(`Desktop pairing page: ${desktopUrl}`);
  console.log(`Mobile QR URL: ${mobileUrl}`);
}

function requestJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => parseJsonResponse(chunks, resolve, reject));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function postJson(url, body, timeout) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      timeout,
      headers: {
        "content-type": "application/json",
        "content-length": payload.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => parseJsonResponse(chunks, resolve, reject));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}

function parseJsonResponse(chunks, resolve, reject) {
  try {
    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    reject(error);
  }
}

async function openUrl(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const openArgs = platform === "win32" ? ["/c", "start", "", url] : [url];
  await execFile(command, openArgs).catch(() => {
    console.log(`Open this URL manually: ${url}`);
  });
}

function shutdown() {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}
