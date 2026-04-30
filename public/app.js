const state = {
  token: localStorage.getItem("codexMobileToken"),
  projects: [],
  threads: [],
  selectedProject: null,
  selectedThread: null,
  thread: null,
  context: null,
  changes: null,
  branches: null,
  skills: [],
  models: [],
  modelConfig: null,
  selectedModel: localStorage.getItem("codexMobileModel") || "",
  selectedEffort: localStorage.getItem("codexMobileEffort") || "",
  activeTab: "chat",
  projectSearch: "",
  threadSearch: "",
  settings: null,
  ws: null,
  approvals: new Map(),
  loginPoll: null,
  desktopReady: false,
  installPrompt: null,
};

const app = document.querySelector("#app");

init();

async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    renderCurrentView();
  });
  const pair = new URL(location.href).searchParams.get("pair");
  if (pair && !state.token) {
    document.querySelector("#pair-code").value = pair;
    await completePair(pair);
    history.replaceState({}, "", "/");
  }
  if (!state.token) {
    bindPairing();
    await loadDesktopStatus();
    return;
  }
  await loadProjects();
}

function renderCurrentView() {
  if (!state.token) return;
  if (state.thread) return renderThread();
  if (state.selectedProject) return renderThreads();
  renderProjects();
}

function bindPairing() {
  document.querySelector("#desktop-status")?.addEventListener("click", async (event) => {
    if (event.target.closest("[data-recheck]")) await loadDesktopStatus();
    if (event.target.closest("[data-start-login]")) await startDesktopLogin();
    if (event.target.closest("[data-cancel-login]")) await cancelDesktopLogin();
  });

  document.querySelector("#pair-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await completePair(document.querySelector("#pair-code").value.trim());
  });

  document.querySelector("#start-pair").addEventListener("click", async () => {
    const help = document.querySelector("#pair-help");
    try {
      const result = await fetchJson("/api/pair/start", { method: "POST", auth: false });
      renderPairingCode(result);
    } catch (error) {
      if (help) help.textContent = error.message;
      await loadDesktopStatus();
    }
  });
}

async function loadDesktopStatus() {
  const container = document.querySelector("#desktop-status");
  if (!container) return;
  container.innerHTML = `<div class="status-row"><span class="status-dot pending"></span><span>Checking desktop Codex setup</span></div>`;
  try {
    const status = await fetchJson("/api/desktop/status", { auth: false });
    state.desktopReady = Boolean(status.ok);
    container.innerHTML = renderDesktopStatus(status);
    updatePairControls();
  } catch (error) {
    state.desktopReady = false;
    updatePairControls();
    container.innerHTML = `
      <div class="status-row"><span class="status-dot bad"></span><span>Desktop status unavailable</span></div>
      <p class="status-detail">${escapeHtml(error.message)}</p>
      <button class="ghost-button" data-recheck type="button">Recheck</button>
    `;
  }
}

async function startDesktopLogin() {
  state.desktopReady = false;
  updatePairControls();
  const container = document.querySelector("#desktop-status");
  if (container) {
    container.innerHTML = `<div class="status-row"><span class="status-dot pending"></span><span>Starting OpenAI login</span></div>`;
  }
  const flow = await fetchJson("/api/desktop/login/start", { method: "POST", auth: false });
  renderLoginFlow(flow);
  if (flow.running || flow.status === "running") pollDesktopLogin();
  else await loadDesktopStatus();
}

async function cancelDesktopLogin() {
  const flow = await fetchJson("/api/desktop/login/cancel", { method: "POST", auth: false });
  renderLoginFlow(flow);
  clearLoginPoll();
  await loadDesktopStatus();
}

function pollDesktopLogin() {
  clearLoginPoll();
  state.loginPoll = setInterval(async () => {
    const flow = await fetchJson("/api/desktop/login/status", { auth: false });
    renderLoginFlow(flow);
    if (!flow.running && flow.status !== "running") {
      clearLoginPoll();
      setTimeout(loadDesktopStatus, 800);
    }
  }, 1500);
}

function clearLoginPoll() {
  if (state.loginPoll) clearInterval(state.loginPoll);
  state.loginPoll = null;
}

function renderLoginFlow(flow) {
  const container = document.querySelector("#desktop-status");
  if (!container) return;
  const running = flow.running || flow.status === "running";
  container.innerHTML = `
    <div class="status-row">
      <span class="status-dot ${running ? "pending" : flow.status === "completed" || flow.status === "already_logged_in" ? "ok" : "bad"}"></span>
      <span>${escapeHtml(formatLoginStatus(flow.status))}</span>
    </div>
    ${flow.output ? `<pre class="login-output">${escapeHtml(flow.output)}</pre>` : ""}
    <div class="status-actions">
      ${running ? `<button class="ghost-button" data-cancel-login type="button">Cancel</button>` : ""}
      <button class="ghost-button" data-recheck type="button">Recheck</button>
    </div>
  `;
}

function formatLoginStatus(status) {
  if (status === "running") return "OpenAI login in progress";
  if (status === "completed") return "OpenAI login completed";
  if (status === "already_logged_in") return "Already logged in";
  if (status === "cancelled") return "OpenAI login cancelled";
  if (status === "failed") return "OpenAI login failed";
  return "OpenAI login";
}

function renderDesktopStatus(status) {
  const codexOk = status.codex?.installed;
  const loginOk = status.login?.loggedIn;
  const ready = codexOk && loginOk;
  const loginFlow = status.loginFlow || {};
  return `
    <div class="status-row">
      <span class="status-dot ${codexOk ? "ok" : "bad"}"></span>
      <span>Codex CLI ${codexOk ? escapeHtml(status.codex.version || "installed") : "not found"}</span>
    </div>
    <div class="status-row">
      <span class="status-dot ${loginOk ? "ok" : "bad"}"></span>
      <span>${loginOk ? `Logged in${status.login.provider ? ` using ${escapeHtml(status.login.provider)}` : ""}` : "OpenAI login required"}</span>
    </div>
    <div class="status-row">
      <span class="status-dot ${ready ? "ok" : "pending"}"></span>
      <span>${ready ? "Ready to show phone QR" : "Desktop setup runs here first"}</span>
    </div>
    ${!codexOk ? `<p class="status-detail">Install Codex CLI first, then recheck.</p>` : ""}
    ${codexOk && !loginOk ? `<p class="status-detail">Start OpenAI login on this computer, then return here after the browser flow completes.</p>` : ""}
    ${loginFlow.output && !loginOk ? `<pre class="login-output">${escapeHtml(loginFlow.output)}</pre>` : ""}
    <div class="status-actions">
      ${codexOk && !loginOk ? `<button class="primary-button small" data-start-login type="button">OpenAI login</button>` : ""}
      <button class="ghost-button" data-recheck type="button">Recheck</button>
    </div>
  `;
}

function updatePairControls() {
  const button = document.querySelector("#start-pair");
  if (!button) return;
  button.disabled = !state.desktopReady;
  button.textContent = state.desktopReady ? "Show mobile QR" : "Finish desktop setup first";
}

function renderPairingCode(result) {
  document.querySelector("#pair-help").innerHTML = `
    <span class="qr-card">${result.qrSvg}</span>
    <span class="pair-code-label">Code ${escapeHtml(result.code)}</span>
    <span class="pair-url">${escapeHtml(result.qrUrl)}</span>
  `;
}

async function completePair(code) {
  const help = document.querySelector("#pair-help");
  try {
    const result = await fetchJson("/api/pair/complete", {
      method: "POST",
      auth: false,
      body: { code, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Mobile" },
    });
    state.token = result.accessToken;
    localStorage.setItem("codexMobileToken", state.token);
    await loadProjects();
  } catch (error) {
    if (help) help.textContent = error.message;
  }
}

async function loadProjects() {
  const result = await fetchJson("/api/projects");
  state.projects = result.projects || [];
  renderProjects();
  connectEvents();
}

async function createThread(cwd, text = "") {
  await loadModels();
  const result = await fetchJson("/api/threads", {
    method: "POST",
    body: {
      cwd,
      text,
      model: state.selectedModel || undefined,
      effort: state.selectedEffort || undefined,
    },
  });
  if (result.thread?.id) await loadThread(result.thread.id);
  else await loadProjects();
}

async function loadThreads(project) {
  state.selectedProject = project;
  const query = new URLSearchParams({ cwd: project.cwd, limit: "100" });
  if (state.threadSearch) query.set("search", state.threadSearch);
  const result = await fetchJson(`/api/threads?${query.toString()}`);
  state.threads = result.data || [];
  renderThreads();
}

async function loadThread(threadId) {
  state.changes = null;
  state.context = null;
  state.branches = null;
  state.skills = [];
  const [result] = await Promise.all([
    fetchJson(`/api/threads/${encodeURIComponent(threadId)}`),
    loadModels(),
  ]);
  state.thread = result.thread;
  state.selectedThread = state.thread;
  await Promise.all([loadThreadContext(threadId), loadChanges(threadId), loadBranches(threadId), loadSkills(state.thread.cwd)]);
  state.approvals.clear();
  renderThread();
  subscribeThread(threadId);
}

async function loadModels() {
  if (state.models.length) return;
  const result = await fetchJson("/api/models");
  state.models = (result.models || []).filter((model) => !model.hidden);
  state.modelConfig = result.config || null;
  if (!state.selectedModel) {
    state.selectedModel = state.modelConfig?.model || state.models.find((model) => model.isDefault)?.model || state.models[0]?.model || "";
  }
  if (!state.selectedEffort) {
    const current = state.models.find((model) => model.model === state.selectedModel || model.id === state.selectedModel);
    state.selectedEffort = state.modelConfig?.effort || current?.defaultReasoningEffort || "";
  }
}

async function loadThreadContext(threadId) {
  state.context = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/context`);
}

async function loadChanges(threadId) {
  state.changes = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/changes`);
}

async function loadBranches(threadId) {
  state.branches = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/branches`);
}

async function loadSkills(cwd) {
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const result = await fetchJson(`/api/skills${query}`);
  state.skills = result.data || [];
}

async function sendMessage(text) {
  if (!text.trim() || !state.thread) return;
  await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/messages`, {
    method: "POST",
    body: {
      text,
      model: state.selectedModel || undefined,
      effort: state.selectedEffort || undefined,
    },
  });
}

async function interruptThread() {
  if (!state.thread) return;
  await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/interrupt`, {
    method: "POST",
    body: {},
  });
}

async function runThreadAction(action) {
  if (!state.thread) return;
  const body = { action };
  if (action === "rename") {
    const name = prompt("Thread name", state.thread.name || state.thread.preview || "");
    if (!name) return;
    body.name = name;
  }
  if (action === "rollback") {
    if (!confirm("Rollback drops recent thread turns. It does not revert file changes. Continue?")) return;
    body.numTurns = 1;
  }
  if (action === "archive" && !confirm("Archive this thread?")) return;
  if (action === "fork") {
    body.cwd = state.thread.cwd;
    body.model = state.selectedModel || undefined;
  }
  const result = await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/actions`, {
    method: "POST",
    body,
  });
  const nextThread = result.thread || result.forkedThread;
  if (nextThread?.id) await loadThread(nextThread.id);
  else if (action === "archive") await loadThreads(state.selectedProject);
  else await loadThread(state.thread.id);
}

async function checkoutBranch(branch, create = false) {
  if (!state.thread || !branch) return;
  await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/git/checkout`, {
    method: "POST",
    body: { branch, create },
  });
  await Promise.all([loadThreadContext(state.thread.id), loadChanges(state.thread.id), loadBranches(state.thread.id)]);
  renderThread();
}

async function commitChanges() {
  if (!state.thread) return;
  const message = prompt("Commit message", "");
  if (!message) return;
  if (!confirm("Commit all current working tree changes?")) return;
  await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/git/commit`, {
    method: "POST",
    body: { message, stageAll: true },
  });
  await loadChanges(state.thread.id);
  renderThread();
}

async function loadSettings() {
  const query = state.selectedProject?.cwd ? `?cwd=${encodeURIComponent(state.selectedProject.cwd)}` : "";
  state.settings = await fetchJson(`/api/settings${query}`);
  renderSettings();
}

async function installApp() {
  if (state.installPrompt) {
    const promptEvent = state.installPrompt;
    state.installPrompt = null;
    promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    renderCurrentView();
    return;
  }
  alert("iPhone에서는 Safari 공유 버튼을 누른 뒤 '홈 화면에 추가'를 선택하세요.");
}

async function answerApproval(requestId, decision, remember = false) {
  await fetchJson(`/api/approvals/${encodeURIComponent(requestId)}`, {
    method: "POST",
    body: { decision, remember },
  });
  state.approvals.delete(requestId);
  renderThread();
}

function connectEvents() {
  if (state.ws) state.ws.close();
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${location.host}/api/events?token=${encodeURIComponent(state.token)}`);
  state.ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "approvalRequested") {
      state.approvals.set(message.requestId, message);
      renderThread();
      return;
    }
    if (message.type !== "codexEvent") return;
    applyCodexEvent(message.event);
  });
}

function subscribeThread(threadId) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "subscribeThread", threadId }));
  } else {
    state.ws?.addEventListener("open", () => subscribeThread(threadId), { once: true });
  }
}

function applyCodexEvent(event) {
  if (!state.thread || event.params?.threadId !== state.thread.id) return;
  const turns = state.thread.turns || [];

  if (event.method === "turn/started") {
    turns.push(event.params.turn);
  }

  if (event.method === "item/started" || event.method === "item/completed") {
    const turn = turns.find((candidate) => candidate.id === event.params.turnId) || turns.at(-1);
    if (turn) {
      turn.items ||= [];
      const item = event.params.item;
      const index = turn.items.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) turn.items[index] = item;
      else turn.items.push(item);
    }
  }

  if (event.method === "item/agentMessage/delta") {
    const turn = turns.find((candidate) => candidate.id === event.params.turnId) || turns.at(-1);
    if (turn) {
      turn.items ||= [];
      let item = turn.items.find((candidate) => candidate.id === event.params.itemId);
      if (!item) {
        item = { id: event.params.itemId, type: "agentMessage", text: "" };
        turn.items.push(item);
      }
      item.text = `${item.text || ""}${event.params.delta || ""}`;
    }
  }

  if (event.method === "turn/completed") {
    const turn = turns.find((candidate) => candidate.id === event.params.turnId);
    if (turn) turn.status = event.params.turn?.status || "completed";
    loadChanges(state.thread.id).then(renderThread).catch(() => {});
  }

  if (event.method === "turn/diff/updated") {
    state.changes = {
      ...(state.changes || {}),
      threadId: event.params.threadId,
      turnDiff: {
        turnId: event.params.turnId,
        diff: event.params.diff || "",
        updatedAt: Date.now(),
      },
    };
  }

  if (event.method === "serverRequest/resolved") {
    state.approvals.delete(String(event.params.requestId));
  }

  if (event.method === "thread/status/changed") {
    state.thread.status = event.params.status || event.params.thread?.status || state.thread.status;
  }

  if (event.method === "thread/name/updated") {
    state.thread.name = event.params.name || state.thread.name;
  }

  if (event.method === "thread/compacted") {
    loadThread(state.thread.id).catch(() => {});
  }

  renderThread();
}

function renderProjects() {
  const projects = state.projectSearch
    ? state.projects.filter((project) => `${project.name} ${project.cwd}`.toLowerCase().includes(state.projectSearch.toLowerCase()))
    : state.projects;
  app.innerHTML = shell("Projects", "Local Codex workspaces", `
    <div class="toolbar">
      <input id="project-search" value="${escapeAttr(state.projectSearch)}" placeholder="Search projects" />
      <button class="ghost-button compact" data-new-thread type="button">New</button>
    </div>
    <div class="main-scroll">
      ${projects.map((project) => `
        <button class="project-row" data-cwd="${escapeAttr(project.cwd)}">
          <span class="project-icon">${folderIcon()}</span>
          <span class="row-main">
            <strong>${escapeHtml(project.name)}</strong>
            <span>${escapeHtml(project.cwd)}</span>
          </span>
          <span class="row-meta">${project.threadCount}</span>
        </button>
      `).join("") || `<p class="empty-state">No Codex projects found.</p>`}
    </div>
  `);
  app.querySelectorAll(".project-row").forEach((row) => {
    row.addEventListener("click", () => loadThreads(state.projects.find((project) => project.cwd === row.dataset.cwd)));
  });
  app.querySelector("#project-search")?.addEventListener("input", (event) => {
    state.projectSearch = event.target.value;
    renderProjects();
  });
  app.querySelector("[data-new-thread]")?.addEventListener("click", () => {
    const cwd = prompt("Working directory", state.selectedProject?.cwd || "");
    if (!cwd) return;
    const text = prompt("First message", "");
    createThread(cwd, text || "").catch((error) => alert(error.message));
  });
}

function renderThreads() {
  app.innerHTML = shell(state.selectedProject.name, state.selectedProject.cwd, `
    <div class="toolbar">
      <input id="thread-search" value="${escapeAttr(state.threadSearch)}" placeholder="Search threads" />
      <button class="ghost-button compact" data-new-thread type="button">New</button>
    </div>
    <div class="main-scroll">
      ${state.threads.map((thread) => `
        <button class="thread-row" data-thread-id="${thread.id}">
          <span class="row-main">
            <strong>${escapeHtml(thread.name || thread.title || thread.preview || "Untitled")}</strong>
            <span>${formatDate(thread.updatedAt || thread.createdAt)}</span>
          </span>
          <span class="row-meta">${escapeHtml(formatThreadStatus(thread.status))}</span>
        </button>
      `).join("") || `<p class="empty-state">No threads in this project.</p>`}
    </div>
  `, { back: renderProjects });
  app.querySelectorAll(".thread-row").forEach((row) => {
    row.addEventListener("click", () => loadThread(row.dataset.threadId));
  });
  app.querySelector("#thread-search")?.addEventListener("change", (event) => {
    state.threadSearch = event.target.value;
    loadThreads(state.selectedProject);
  });
  app.querySelector("[data-new-thread]")?.addEventListener("click", () => {
    const text = prompt("First message", "");
    createThread(state.selectedProject.cwd, text || "").catch((error) => alert(error.message));
  });
}

function renderThread() {
  const thread = state.thread;
  const turns = thread?.turns || [];
  const content = state.activeTab === "changes" ? renderChanges() : renderChat(turns);
  app.innerHTML = shell(thread.name || thread.preview || "Thread", thread.cwd, `
    ${renderThreadContext()}
    ${renderThreadTabs()}
    ${content}
    ${state.activeTab === "chat" ? renderComposer() : ""}
  `, { back: () => loadThreads(state.selectedProject) });
  bindThreadControls();
}

function renderChat(turns) {
  return `
    <div class="main-scroll timeline">
      ${turns.flatMap((turn) => turn.items || []).map(renderItem).join("")}
      ${[...state.approvals.values()].map(renderApproval).join("")}
    </div>
  `;
}

function renderComposer() {
  return `
    <div class="skill-picker" id="skill-picker" hidden></div>
    <form class="composer" id="composer">
      <textarea id="message-input" placeholder="Message Codex"></textarea>
      <button aria-label="Send">↑</button>
    </form>
  `;
}

function bindThreadControls() {
  app.querySelector("#composer")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = app.querySelector("#message-input");
    const text = input.value;
    input.value = "";
    hideSkillSuggestions();
    await sendMessage(text);
  });
  const messageInput = app.querySelector("#message-input");
  messageInput?.addEventListener("input", () => updateSkillSuggestions(messageInput));
  messageInput?.addEventListener("selectionchange", () => updateSkillSuggestions(messageInput));
  app.querySelectorAll("[data-approval]").forEach((button) => {
    button.addEventListener("click", () => {
      answerApproval(button.dataset.approval, button.dataset.decision, button.dataset.remember === "true");
    });
  });
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderThread();
    });
  });
  app.querySelector("#model-select")?.addEventListener("change", (event) => {
    state.selectedModel = event.target.value;
    localStorage.setItem("codexMobileModel", state.selectedModel);
    const current = state.models.find((model) => model.model === state.selectedModel || model.id === state.selectedModel);
    if (current?.defaultReasoningEffort) {
      state.selectedEffort = current.defaultReasoningEffort;
      localStorage.setItem("codexMobileEffort", state.selectedEffort);
    }
    renderThread();
  });
  app.querySelector("#effort-select")?.addEventListener("change", (event) => {
    state.selectedEffort = event.target.value;
    localStorage.setItem("codexMobileEffort", state.selectedEffort);
  });
  app.querySelector("#branch-select")?.addEventListener("change", async (event) => {
    const value = event.target.value;
    try {
      if (value === "__create__") {
        const branch = prompt("New branch name", "");
        if (!branch) {
          renderThread();
          return;
        }
        await checkoutBranch(branch, true);
        return;
      }
      await checkoutBranch(value);
    } catch (error) {
      alert(error.message);
      renderThread();
    }
  });
  app.querySelector("[data-refresh-changes]")?.addEventListener("click", async () => {
    await loadChanges(state.thread.id);
    renderThread();
  });
  app.querySelector("[data-commit-changes]")?.addEventListener("click", () => {
    commitChanges().catch((error) => alert(error.message));
  });
  app.querySelector("[data-interrupt]")?.addEventListener("click", () => {
    interruptThread().catch((error) => alert(error.message));
  });
  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      runThreadAction(button.dataset.action).catch((error) => alert(error.message));
    });
  });
  const scroll = app.querySelector(".main-scroll");
  if (scroll && state.activeTab === "chat") scroll.scrollTop = scroll.scrollHeight;
}

function updateSkillSuggestions(input) {
  const picker = app.querySelector("#skill-picker");
  if (!picker) return;
  const token = getSkillToken(input);
  if (!token) {
    hideSkillSuggestions();
    return;
  }
  const query = token.query.toLowerCase();
  const matches = state.skills
    .filter((skill) => {
      const haystack = `${skill.name || ""} ${skill.description || ""}`.toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, 8);
  picker.hidden = false;
  picker.innerHTML = `
    <div class="skill-picker-header">
      <strong>Skills</strong>
      <span>${matches.length ? "Tap to insert" : "No installed skills found"}</span>
    </div>
    ${matches.map((skill) => `
      <button class="skill-option" data-skill="${escapeAttr(skill.name)}" type="button">
        <strong>$${escapeHtml(skill.name)}</strong>
        ${skill.description ? `<span>${escapeHtml(skill.description)}</span>` : ""}
      </button>
    `).join("")}
  `;
  picker.querySelectorAll("[data-skill]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      insertSkillToken(input, token, button.dataset.skill);
    });
  });
}

function hideSkillSuggestions() {
  const picker = app.querySelector("#skill-picker");
  if (picker) picker.hidden = true;
}

function getSkillToken(input) {
  const cursor = input.selectionStart || 0;
  const before = input.value.slice(0, cursor);
  const match = before.match(/(^|\s)\$([A-Za-z0-9_-]*)$/);
  if (!match) return null;
  return {
    start: cursor - match[2].length - 1,
    end: cursor,
    query: match[2],
  };
}

function insertSkillToken(input, token, skillName) {
  const before = input.value.slice(0, token.start);
  const after = input.value.slice(token.end);
  const inserted = `$${skillName} `;
  input.value = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  hideSkillSuggestions();
}

function renderThreadContext() {
  const git = state.context?.git || state.changes || state.thread?.gitInfo || {};
  const config = state.context?.config || state.modelConfig || {};
  const model = state.selectedModel || config.model || "default";
  const effortOptions = currentEfforts();
  const branchOptions = state.branches?.branches || [];
  const currentBranch = state.branches?.current || git.branch || state.thread?.gitInfo?.branch || "none";
  return `
    <section class="thread-context">
      <div class="context-grid">
        <label class="context-chip select-chip">
          <small>Branch</small>
          <select id="branch-select" aria-label="Branch">
            ${branchOptions.map((branch) => `<option value="${escapeAttr(branch.name)}" ${branch.name === currentBranch ? "selected" : ""}>${escapeHtml(branch.name)}</option>`).join("") || `<option>${escapeHtml(currentBranch)}</option>`}
            <option value="__create__">New branch...</option>
          </select>
        </label>
        <label class="context-chip select-chip">
          <small>Model</small>
          <select id="model-select" aria-label="Model">
            ${state.models.map((item) => {
              const value = item.model || item.id;
              return `<option value="${escapeAttr(value)}" ${value === model ? "selected" : ""}>${escapeHtml(item.displayName || value)}</option>`;
            }).join("") || `<option>${escapeHtml(model)}</option>`}
          </select>
        </label>
        <label class="context-chip select-chip">
          <small>Reasoning</small>
          <select id="effort-select" aria-label="Reasoning effort">
            ${effortOptions.map((effort) => `<option value="${escapeAttr(effort)}" ${effort === state.selectedEffort ? "selected" : ""}>${escapeHtml(effort)}</option>`).join("")}
          </select>
        </label>
        <span class="context-chip">
          <small>Permission</small>
          <strong>${escapeHtml(formatPermission(config))}</strong>
        </span>
      </div>
      <div class="thread-actions">
        <button class="ghost-button compact" data-interrupt type="button">Stop</button>
        <button class="ghost-button compact" data-action="rename" type="button">Rename</button>
        <button class="ghost-button compact" data-action="fork" type="button">Fork</button>
        <button class="ghost-button compact" data-action="compact" type="button">Compact</button>
        <button class="ghost-button compact" data-action="rollback" type="button">Rollback</button>
        <button class="ghost-button compact danger" data-action="archive" type="button">Archive</button>
      </div>
    </section>
  `;
}

function renderThreadTabs() {
  const count = state.changes?.summary?.filesChanged || 0;
  return `
    <nav class="thread-tabs" aria-label="Thread sections">
      <button class="tab-button ${state.activeTab === "chat" ? "active" : ""}" data-tab="chat" type="button">Chat</button>
      <button class="tab-button ${state.activeTab === "changes" ? "active" : ""}" data-tab="changes" type="button">Changes ${count ? `<span>${count}</span>` : ""}</button>
    </nav>
  `;
}

function renderChanges() {
  const changes = state.changes;
  if (!changes) return `<div class="main-scroll"><p class="empty-state">Loading changes...</p></div>`;
  if (!changes.ok) return `<div class="main-scroll"><p class="empty-state">${escapeHtml(changes.error || "No git context for this thread.")}</p></div>`;
  const files = changes.files || [];
  const summary = changes.summary || {};
  return `
    <div class="main-scroll changes-view">
      <section class="change-summary">
        <div>
          <strong>${summary.filesChanged || 0} files changed</strong>
          <span><b>+${summary.additions || 0}</b> <i>-${summary.deletions || 0}</i></span>
        </div>
        <div class="change-actions">
          <button class="ghost-button compact" data-refresh-changes type="button">Refresh</button>
          <button class="ghost-button compact" data-commit-changes type="button" ${summary.filesChanged ? "" : "disabled"}>Commit</button>
        </div>
      </section>
      ${changes.turnDiff?.diff ? renderTurnDiff(changes.turnDiff) : ""}
      ${files.map(renderChangeFile).join("") || `<p class="empty-state">No working tree changes.</p>`}
    </div>
  `;
}

function renderTurnDiff(turnDiff) {
  return `
    <details class="change-file" open>
      <summary>
        <span class="status-code">Δ</span>
        <span class="file-path">Latest turn diff</span>
        <span class="file-stats">${formatClock(turnDiff.updatedAt)}</span>
      </summary>
      <pre class="diff-block">${escapeHtml(turnDiff.diff)}</pre>
    </details>
  `;
}

function renderChangeFile(file) {
  const additions = file.additions == null ? "" : `+${file.additions}`;
  const deletions = file.deletions == null ? "" : `-${file.deletions}`;
  return `
    <details class="change-file">
      <summary>
        <span class="status-code">${escapeHtml(file.status)}</span>
        <span class="file-path">${escapeHtml(file.path)}</span>
        <span class="file-stats"><b>${escapeHtml(additions)}</b> <i>${escapeHtml(deletions)}</i></span>
      </summary>
      ${file.diff ? `<pre class="diff-block">${escapeHtml(file.diff)}</pre>` : `<p class="muted file-note">No unified diff available for this file yet.</p>`}
    </details>
  `;
}

function currentEfforts() {
  const model = state.models.find((item) => item.model === state.selectedModel || item.id === state.selectedModel);
  const efforts = (model?.supportedReasoningEfforts || []).map((item) => item.reasoningEffort);
  return efforts.length ? efforts : ["minimal", "low", "medium", "high", "xhigh"];
}

function formatPermission(config) {
  const approval = typeof config.approvalPolicy === "string" ? config.approvalPolicy : "default";
  const sandbox = typeof config.sandboxMode === "string" ? config.sandboxMode : "workspace";
  return `${approval} · ${sandbox}`;
}

function formatThreadStatus(status) {
  if (!status) return "";
  if (typeof status === "string") return status;
  if (typeof status === "object") return status.type || status.status || status.phase || "";
  return String(status);
}

function renderItem(item) {
  const type = item.type || item.kind || "unknown";
  if (type === "userMessage") return `<div class="message user">${escapeHtml(extractText(item))}</div>`;
  if (type === "agentMessage") return `<div class="message agent">${escapeHtml(extractText(item))}</div>`;
  if (type === "commandExecution" || type === "fileChange" || type === "webSearch") {
    return `<details class="tool-card"><summary>${escapeHtml(type)}</summary><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></details>`;
  }
  return `<details class="tool-card"><summary>${escapeHtml(type)}</summary><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></details>`;
}

function renderApproval(approval) {
  const summary = summarizeApproval(approval);
  return `
    <div class="approval-card">
      <strong>${escapeHtml(summary.title)}</strong>
      <p class="muted">${escapeHtml(summary.detail)}</p>
      <details class="tool-card"><summary>Details</summary><pre>${escapeHtml(JSON.stringify(approval.params, null, 2))}</pre></details>
      <div class="approval-actions">
        <button class="allow" data-approval="${approval.requestId}" data-decision="allow">Allow once</button>
        <button class="allow soft" data-approval="${approval.requestId}" data-decision="allow" data-remember="true">Session</button>
        <button class="deny" data-approval="${approval.requestId}" data-decision="deny">Deny</button>
        <button class="deny soft" data-approval="${approval.requestId}" data-decision="cancel">Cancel</button>
      </div>
    </div>
  `;
}

function summarizeApproval(approval) {
  const params = approval.params || {};
  const command = params.command || params.cmd || params.argv?.join?.(" ");
  const filePath = params.path || params.file || params.filePath;
  const permissions = params.permissions || params.permissionProfile || params.sandboxPolicy;
  if (command) {
    return { title: "Command approval", detail: Array.isArray(command) ? command.join(" ") : command };
  }
  if (filePath) {
    return { title: "File change approval", detail: filePath };
  }
  if (permissions) {
    return { title: "Permission approval", detail: typeof permissions === "string" ? permissions : JSON.stringify(permissions) };
  }
  return { title: "Approval requested", detail: approval.method || "Codex is waiting for your decision" };
}

function renderSettings() {
  const settings = state.settings || {};
  const account = settings.account?.account;
  const pluginCount = collectPlugins(settings.plugins).length;
  const skills = (settings.skills?.data || []).flatMap((entry) => entry.skills || []);
  const apps = settings.apps?.data || [];
  const automations = settings.automations?.data || [];
  const mcpServers = settings.mcpServers?.mcpServers || settings.mcpServers?.data || [];
  app.innerHTML = shell("Settings", "Account, plugins, skills, automations", `
    <div class="main-scroll settings-view">
      <section class="settings-card">
        <h2>Account</h2>
        <p>${escapeHtml(formatAccount(account, settings.account?.requiresOpenaiAuth))}</p>
        ${renderRateLimit(settings.rateLimits)}
      </section>
      <section class="settings-card">
        <h2>Runtime</h2>
        <p>Model ${escapeHtml(settings.config?.summary?.model || "default")} · Reasoning ${escapeHtml(settings.config?.summary?.effort || "default")}</p>
        <p>Approval ${escapeHtml(formatPermission(settings.config?.summary || {}))}</p>
      </section>
      ${renderCollection("Plugins", pluginCount, collectPlugins(settings.plugins).map((plugin) => plugin.interface?.displayName || plugin.name))}
      ${renderCollection("Skills", skills.length, skills.map((skill) => skill.name || skill.metadata?.name))}
      ${renderCollection("Apps", apps.length, apps.map((item) => item.name || item.id))}
      ${renderCollection("MCP Servers", mcpServers.length, mcpServers.map((item) => item.name || item.id || item.serverName))}
      ${renderCollection("Automations", automations.length, automations.map((item) => `${item.name}${item.status ? ` · ${item.status}` : ""}`))}
    </div>
  `, { back: state.thread ? renderThread : state.selectedProject ? () => loadThreads(state.selectedProject) : renderProjects });
}

function collectPlugins(plugins) {
  return (plugins?.marketplaces || []).flatMap((market) => market.plugins || []);
}

function renderCollection(title, count, items) {
  return `
    <section class="settings-card">
      <h2>${escapeHtml(title)} <span>${count}</span></h2>
      <div class="settings-list">
        ${items.slice(0, 30).map((item) => `<span>${escapeHtml(item || "Untitled")}</span>`).join("") || `<p class="muted">No items.</p>`}
      </div>
    </section>
  `;
}

function renderRateLimit(rateLimits) {
  const primary = rateLimits?.rateLimits?.primary;
  if (!primary) return "";
  return `<p>Usage ${escapeHtml(primary.usedPercent)}%${primary.resetsAt ? ` · resets ${formatDate(primary.resetsAt)}` : ""}</p>`;
}

function formatAccount(account, requiresOpenaiAuth) {
  if (account?.type === "chatgpt") return `${account.email} · ${account.planType}`;
  if (account?.type) return account.type;
  return requiresOpenaiAuth ? "Login required" : "No account details";
}

function shell(title, subtitle, content, options = {}) {
  setTimeout(() => {
    const back = app.querySelector("[data-back]");
    if (back && options.back) back.addEventListener("click", options.back);
    const disconnect = app.querySelector("[data-disconnect]");
    if (disconnect) disconnect.addEventListener("click", () => {
      localStorage.removeItem("codexMobileToken");
      location.reload();
    });
    const settings = app.querySelector("[data-settings]");
    if (settings) settings.addEventListener("click", () => loadSettings().catch((error) => alert(error.message)));
    const install = app.querySelector("[data-install]");
    if (install) install.addEventListener("click", () => installApp().catch((error) => alert(error.message)));
  });
  const canShowInstall = state.installPrompt || isIosSafari();
  return `
    <section class="workspace">
      <header class="topbar">
        ${options.back ? `<button class="icon-button" data-back aria-label="Back">‹</button>` : ""}
        <div class="topbar-title">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle || "")}</span>
        </div>
        ${canShowInstall ? `<button class="icon-button" data-install aria-label="Install">⌂</button>` : ""}
        <button class="icon-button" data-settings aria-label="Settings">⚙</button>
        <button class="icon-button" data-disconnect aria-label="Disconnect">×</button>
      </header>
      ${content}
    </section>
  `;
}

function isIosSafari() {
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  return !standalone && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function fetchJson(url, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.auth !== false && state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function extractText(item) {
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part) => part.text || part.content || "").join("");
  return "";
}

function formatDate(seconds) {
  if (!seconds) return "";
  return new Intl.DateTimeFormat("ko", { dateStyle: "short", timeStyle: "short" }).format(new Date(seconds * 1000));
}

function formatClock(milliseconds) {
  if (!milliseconds) return "";
  return new Intl.DateTimeFormat("ko", { timeStyle: "short" }).format(new Date(milliseconds));
}

function folderIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke="currentColor" stroke-width="1.8"/></svg>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}
