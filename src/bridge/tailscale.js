import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const CLI_TIMEOUT_MS = 2000;

export async function tailscaleAvailable() {
  try {
    await execFile("tailscale", ["--version"], { timeout: CLI_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export async function homebrewAvailable() {
  if (process.platform !== "darwin") return false;
  try {
    await execFile("brew", ["--version"], { timeout: CLI_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export function installTailscaleWithHomebrew() {
  return new Promise((resolve, reject) => {
    const child = spawn("brew", ["install", "--cask", "tailscale"], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`brew install --cask tailscale exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

export async function openTailscaleApp() {
  if (process.platform !== "darwin") return false;
  try {
    await execFile("open", ["-a", "Tailscale"], { timeout: CLI_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

export async function tailscaleStatus() {
  try {
    const { stdout } = await execFile("tailscale", ["status", "--json"], { timeout: CLI_TIMEOUT_MS });
    const data = JSON.parse(stdout);
    return {
      ok: true,
      running: data?.BackendState === "Running",
      backendState: data?.BackendState,
      dnsName: stripTrailingDot(data?.Self?.DNSName),
    };
  } catch (error) {
    return { ok: false, running: false, error: String(error.message || error) };
  }
}

export async function tailscaleServeStatus() {
  try {
    const { stdout } = await execFile("tailscale", ["serve", "status", "--json"], { timeout: CLI_TIMEOUT_MS });
    const text = String(stdout).trim();
    if (!text || text === "{}") return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function detectFunnelUrl(port) {
  const [status, serve] = await Promise.all([tailscaleStatus(), tailscaleServeStatus()]);
  if (!status.running || !status.dnsName || !serve) return null;
  const targets = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http+insecure://127.0.0.1:${port}`,
    `http+insecure://localhost:${port}`,
  ]);
  const web = serve.Web || {};
  const allowFunnel = serve.AllowFunnel || {};
  for (const [host, config] of Object.entries(web)) {
    if (!allowFunnel[host]) continue;
    const handlers = config?.Handlers || {};
    const matchesPort = Object.values(handlers).some((handler) => targets.has(handler?.Proxy));
    if (!matchesPort) continue;
    const dnsName = host.replace(/:\d+$/, "") || status.dnsName;
    return `https://${dnsName}`;
  }
  return null;
}

export function enableFunnel(port) {
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["tailscale", "funnel", "--bg", String(port)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tailscale funnel exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function stripTrailingDot(value) {
  if (!value || typeof value !== "string") return null;
  return value.endsWith(".") ? value.slice(0, -1) : value;
}
