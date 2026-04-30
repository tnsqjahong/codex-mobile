import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

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

if (!ok) {
  console.log("");
  console.log("Next steps:");
  console.log("- Install Codex CLI if missing.");
  console.log("- Run `codex login --device-auth` if not logged in.");
  process.exitCode = 1;
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
