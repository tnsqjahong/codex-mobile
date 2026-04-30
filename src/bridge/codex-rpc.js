import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

export class CodexRpc extends EventEmitter {
  constructor({ codexBin = "codex" } = {}) {
    super();
    this.codexBin = codexBin;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.serverRequests = new Map();
    this.readyPromise = null;
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;

    this.proc = spawn(this.codexBin, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (${code ?? signal})`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
      this.emit("exit", { code, signal });
    });

    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (text.trim()) this.emit("stderr", text);
    });

    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.emit("protocolError", { error: String(error), line });
        return;
      }
      this.#handleMessage(message);
    });

    this.readyPromise = (async () => {
      await this.request("initialize", {
        clientInfo: {
          name: "codex_mobile_companion",
          title: "Codex Mobile Companion",
          version: "0.1.0",
        },
      });
      this.notify("initialized", {});
      return true;
    })();

    return this.readyPromise;
  }

  request(method, params = {}) {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(new Error("codex app-server is not running"));
    }

    const id = this.nextId++;
    const message = { method, id, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 60_000);

      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.#send(message);
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  respond(id, result) {
    if (!this.serverRequests.has(String(id))) {
      throw new Error(`Unknown server request: ${id}`);
    }
    this.serverRequests.delete(String(id));
    this.#send({ id, result });
  }

  stop() {
    if (this.proc && !this.proc.killed) this.proc.kill();
  }

  #send(message) {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "JSON-RPC error"));
      else pending.resolve(message.result);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.serverRequests.set(String(message.id), message);
      this.emit("serverRequest", message);
      return;
    }

    this.emit("notification", message);
  }
}

export function redact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-REDACTED")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer REDACTED")
    .replace(/OPENAI_API_KEY\s*=\s*[^\s"']+/g, "OPENAI_API_KEY=REDACTED")
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, "PRIVATE_KEY_REDACTED");
}
