import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline/promises";

import {
  tailscaleAvailable,
  tailscaleStatus,
  detectFunnelUrl,
  enableFunnel,
  homebrewAvailable,
  installTailscaleWithHomebrew,
  openTailscaleApp,
} from "./tailscale.js";

const execFile = promisify(execFileCallback);
const port = Number(process.env.PORT || 8787);

const checks = [
  ["Node.js", process.version, Number(process.versions.node.split(".")[0]) >= 20],
  ["Codex CLI", await commandOutput("codex", ["--version"]), null],
  ["Codex login", await commandOutput("codex", ["login", "status"]), null],
];

let ok = true;
for (const [name, value, passedOverride] of checks) {
  const passed = passedOverride ?? Boolean(value && !value.startsWith("ERROR:"));
  ok &&= passed;
  console.log(`${passed ? "OK" : "FAIL"} ${name}: ${value || "not available"}`);
}

await runTailscaleSection();

if (!ok) {
  console.log("");
  console.log("Next steps:");
  console.log("- Install Codex CLI if missing.");
  console.log("- Run `codex login --device-auth` if not logged in.");
  process.exitCode = 1;
}

async function runTailscaleSection() {
  console.log("");
  console.log("Tailscale Funnel (optional, for stable PWA URL):");
  if (!(await tailscaleAvailable())) {
    await offerTailscaleInstall();
    return;
  }
  const status = await tailscaleStatus();
  if (!status.running) {
    console.log(`  SKIP Tailscale not logged in (state: ${status.backendState || "unknown"}).`);
    if (await openTailscaleApp()) {
      console.log("       Opened Tailscale. Sign in there, then re-run `npm run setup`.");
    } else {
      console.log("       Open Tailscale or run `tailscale up`, finish login, then re-run setup.");
    }
    return;
  }
  const existingUrl = await detectFunnelUrl(port);
  if (existingUrl) {
    console.log(`  OK   Funnel already exposes port ${port} at ${existingUrl}`);
    console.log("       Mobile QR will use this URL automatically.");
    return;
  }
  console.log(`  Funnel for port ${port} is not configured (device: ${status.dnsName}).`);
  if (!process.stdin.isTTY) {
    console.log("       Skipping interactive prompt (non-TTY). To enable manually:");
    console.log(`         sudo tailscale funnel --bg ${port}`);
    return;
  }
  if (!(await askYesNo("       Enable now (sudo password required)? [y/N] "))) {
    console.log("       Skipped. To enable later:");
    console.log(`         sudo tailscale funnel --bg ${port}`);
    return;
  }
  try {
    await enableFunnel(port);
  } catch (error) {
    console.log(`       Failed to enable Funnel: ${error.message}`);
    return;
  }
  const finalUrl = await detectFunnelUrl(port);
  if (finalUrl) {
    console.log(`  OK   Funnel enabled at ${finalUrl}`);
    console.log("       `npm start` will now use this URL for the mobile QR.");
  } else {
    console.log("       Funnel command finished but URL could not be detected.");
    console.log("       Check `tailscale serve status --json` manually.");
  }
}

async function offerTailscaleInstall() {
  console.log("  SKIP Tailscale CLI not found.");
  if (process.platform !== "darwin") {
    console.log("       Install it from https://tailscale.com/download to enable an");
    console.log("       always-on HTTPS URL for the mobile companion.");
    return;
  }
  if (!(await homebrewAvailable())) {
    console.log("       Homebrew was not found. Install Tailscale from:");
    console.log("       https://tailscale.com/download/mac");
    return;
  }
  if (!process.stdin.isTTY) {
    console.log("       To install on macOS with Homebrew:");
    console.log("         brew install --cask tailscale");
    console.log("       Then open Tailscale, sign in, and re-run `npm run setup`.");
    return;
  }
  if (!(await askYesNo("       Install Tailscale now with Homebrew? [y/N] "))) {
    console.log("       Skipped. To install later:");
    console.log("         brew install --cask tailscale");
    return;
  }
  try {
    await installTailscaleWithHomebrew();
  } catch (error) {
    console.log(`       Failed to install Tailscale: ${error.message}`);
    console.log("       You can install it manually from https://tailscale.com/download/mac");
    return;
  }
  console.log("  OK   Tailscale installed.");
  if (await openTailscaleApp()) {
    console.log("       Opened Tailscale. Sign in there, then re-run `npm run setup`.");
  } else {
    console.log("       Open Tailscale, sign in, then re-run `npm run setup`.");
  }
}

async function askYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function commandOutput(command, args) {
  try {
    const result = await execFile(command, args, { timeout: 5000 });
    return clean(`${result.stdout}${result.stderr}`);
  } catch (error) {
    return `ERROR: ${clean(`${error.stdout || ""}${error.stderr || ""}${error.message || error}`)}`;
  }
}

function clean(output) {
  return String(output)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("could not update PATH"))
    .join(" ");
}
