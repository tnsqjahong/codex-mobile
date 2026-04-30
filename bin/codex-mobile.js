#!/usr/bin/env node
import { execFile as execFileCallback, spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const openBrowser = !process.argv.includes("--no-open");
const baseUrl = process.env.PUBLIC_URL?.replace(/\/$/, "") || `http://${host === "0.0.0.0" ? getLanAddress() : host}:${port}`;

if (process.argv.includes("--help")) {
  console.log("Usage: codex-mobile [--no-open]");
  process.exit(0);
}

if (await isBridgeRunning()) {
  console.log(`Codex Mobile Companion already running on ${baseUrl}`);
  if (openBrowser) await openUrl(baseUrl);
  process.exit(0);
}

const child = spawn(process.execPath, [path.join(rootDir, "src/bridge/server.js")], {
  cwd: rootDir,
  env: { ...process.env, HOST: host, PORT: String(port), PUBLIC_URL: process.env.PUBLIC_URL || baseUrl },
  stdio: ["ignore", "inherit", "inherit"],
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

await waitForBridge();
console.log(`Open desktop pairing window: ${baseUrl}`);
if (openBrowser) await openUrl(baseUrl);

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

function getLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

async function isBridgeRunning() {
  try {
    const health = await requestJson(`http://127.0.0.1:${port}/api/health`, 600);
    return Boolean(health.ok);
  } catch {
    return false;
  }
}

async function waitForBridge() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await isBridgeRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error("Timed out waiting for Codex Mobile Companion to start");
}

function requestJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

async function openUrl(url) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  await execFile(command, args).catch(() => {
    console.log(`Open this URL manually: ${url}`);
  });
}
