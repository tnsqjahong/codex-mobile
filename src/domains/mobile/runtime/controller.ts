type AnyRecord = Record<string, any>;

const FILE_ATTACHMENT_ACCEPT = [
  ".txt", ".md", ".markdown", ".json", ".jsonl", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".html", ".css", ".scss", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h",
  ".cpp", ".hpp", ".cs", ".sh", ".zsh", ".bash", ".yml", ".yaml", ".toml", ".ini", ".env",
  ".csv", ".tsv", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".tgz", ".rar", ".7z",
  "text/*", "application/json", "application/pdf", "application/zip", "application/x-zip-compressed",
].join(",");

export const state: AnyRecord = {
  version: 0,
  token: localStorage.getItem("codexMobileToken"),
  projects: [],
  threads: [],
  projectsLoading: false,
  selectedProject: null,
  selectedThread: null,
  thread: null,
  context: null,
  changes: null,
  changesLoading: false,
  changesError: "",
  branches: null,
  tokenUsage: null,
  skills: [],
  models: [],
  modelConfig: null,
  selectedModel: localStorage.getItem("codexMobileModel") || "",
  selectedEffort: localStorage.getItem("codexMobileEffort") || "",
  selectedPermission: localStorage.getItem("codexMobilePermission") || "default",
  openComposerMenu: null,
  attachments: [],
  composerMentions: [],
  uploadingAttachments: false,
  draftText: "",
  creatingThread: false,
  startPendingMessage: null,
  screen: "workspace",
  activeTab: "chat",
  projectSearch: "",
  threadSearch: "",
  settings: null,
  ws: null,
  wsReconnectTimer: null,
  wsReconnectAttempts: 0,
  approvals: new Map(),
  loginPoll: null,
  desktopReady: false,
  desktopStatus: null,
  desktopStatusError: "",
  loginFlow: null,
  pairing: null,
  pairingError: "",
  notificationsEnabled: "Notification" in window && Notification.permission === "granted" && localStorage.getItem("codexMobileNotifications") === "enabled",
  sidebarOpen: window.matchMedia("(min-width: 1024px)").matches,
  threadsLoading: false,
  threadRefreshTimer: null,
  threadRefreshAttempts: 0,
  followTail: true,
  messageQueue: [],
  pendingLocalTurns: [],
  previewIdsByPath: {},
  suggestionSeq: 0,
  renderTimer: null,
  pendingRenderTimelineOnly: true,
};

const app = document.querySelector("#app") as HTMLElement;

const listeners = new Set<() => void>();
let viewportListenersInstalled = false;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return state;
}

export function patchState(next: AnyRecord | ((current: AnyRecord) => AnyRecord)) {
  const value = typeof next === "function" ? next(state) : next;
  Object.assign(state, value || {});
  emit();
}

function emit() {
  state.version += 1;
  listeners.forEach((listener) => listener());
}

export async function init() {
  installViewportListeners();
  await removeLegacyWebAppCache();
  const pair = new URL(location.href).searchParams.get("pair");
  if (pair && !state.token) {
    const paired = await completePair(pair);
    if (!paired) return;
    history.replaceState({}, "", "/");
  }
  if (!state.token) {
    bindPairing();
    await loadDesktopStatus();
    return;
  }
  await loadProjects();
}

function installViewportListeners() {
  if (viewportListenersInstalled) return;
  viewportListenersInstalled = true;
  const wideQuery = window.matchMedia("(min-width: 1024px)");
  const syncViewport = () => {
    const visualViewport = window.visualViewport;
    const width = Math.max(320, Math.floor(visualViewport?.width || window.innerWidth || document.documentElement.clientWidth));
    const height = Math.max(320, Math.floor(visualViewport?.height || window.innerHeight || document.documentElement.clientHeight));
    document.documentElement.style.setProperty("--app-width", `${width}px`);
    document.documentElement.style.setProperty("--app-height", `${height}px`);
  };
  const syncSidebar = () => {
    const shouldOpen = wideQuery.matches;
    if (state.sidebarOpen !== shouldOpen) {
      state.sidebarOpen = shouldOpen;
      emit();
    }
  };
  syncViewport();
  syncSidebar();
  window.addEventListener("resize", syncViewport, { passive: true });
  window.addEventListener("orientationchange", syncViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", syncViewport, { passive: true });
  window.visualViewport?.addEventListener("scroll", syncViewport, { passive: true });
  wideQuery.addEventListener("change", syncSidebar);
}

async function removeLegacyWebAppCache() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  }
  if ("caches" in window) {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(keys.filter((key) => key.startsWith("codex-mobile")).map((key) => caches.delete(key).catch(() => false)));
  }
}

function renderCurrentView() {
  emit();
}

function bindPairing() {
  emit();
}

export async function loadDesktopStatus() {
  state.desktopStatusError = "";
  state.pairingError = "";
  emit();
  try {
    const status = await fetchJson("/api/desktop/status", { auth: false });
    state.desktopReady = Boolean(status.ok);
    state.desktopStatus = status;
    state.loginFlow = null;
    if (state.desktopReady) await showPairingQr();
    else state.pairing = null;
  } catch (error) {
    state.desktopReady = false;
    state.desktopStatus = null;
    state.pairing = null;
    state.desktopStatusError = String(error.message || error);
    emit();
  }
}

export async function startDesktopLogin() {
  state.desktopReady = false;
  const flow = await fetchJson("/api/desktop/login/start", { method: "POST", auth: false });
  state.loginFlow = flow;
  emit();
  if (flow.running || flow.status === "running") pollDesktopLogin();
  else await loadDesktopStatus();
}

export async function cancelDesktopLogin() {
  const flow = await fetchJson("/api/desktop/login/cancel", { method: "POST", auth: false });
  state.loginFlow = flow;
  emit();
  clearLoginPoll();
  await loadDesktopStatus();
}

function pollDesktopLogin() {
  clearLoginPoll();
  state.loginPoll = setInterval(async () => {
    const flow = await fetchJson("/api/desktop/login/status", { auth: false });
    state.loginFlow = flow;
    emit();
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
  state.loginFlow = flow;
  emit();
}

function formatLoginStatus(status) {
  if (status === "running") return "OpenAI 로그인 중";
  if (status === "completed") return "로그인 완료";
  if (status === "already_logged_in") return "로그인 완료";
  if (status === "cancelled") return "로그인 취소됨";
  if (status === "failed") return "로그인 실패";
  return "OpenAI 로그인";
}

function renderDesktopStatus(status) {
  const codexOk = status.codex?.installed;
  const loginOk = status.login?.loggedIn;
  const ready = codexOk && loginOk;
  if (ready) return "";
  if (!codexOk) {
    return `
      <button class="primary-button big" data-recheck type="button">다시 확인</button>
      <span class="pairing-minor">Codex CLI 필요</span>
    `;
  }
  return `
    <button class="primary-button big" data-start-login type="button">OpenAI 로그인</button>
  `;
}

export async function showPairingQr() {
  state.pairing = null;
  state.pairingError = "";
  emit();
  try {
    const result = await fetchJson("/api/pair/start", { method: "POST", auth: false });
    renderPairingCode(result);
  } catch (error) {
    state.pairingError = String(error.message || error);
    emit();
  }
}

function renderPairingCode(result) {
  state.pairing = result;
  state.pairingError = "";
  emit();
}

export async function completePair(code) {
  try {
    const result = await fetchJson("/api/pair/complete", {
      method: "POST",
      auth: false,
      body: { code, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : "Mobile" },
    });
    state.token = result.accessToken;
    localStorage.setItem("codexMobileToken", state.token);
    renderWorkspace();
    await loadProjects();
    return true;
  } catch (error) {
    const expired = String(error.message || "").toLowerCase().includes("expired");
    state.pairingError = expired ? "QR 코드가 만료됐어요. 컴퓨터에서 새 QR을 다시 스캔해주세요." : String(error.message || error);
    emit();
    bindPairing();
    return false;
  }
}

async function loadProjects() {
  state.projectsLoading = true;
  renderWorkspace();
  try {
    const result = await fetchJson("/api/projects");
    state.projects = result.projects || [];
    state.projectsLoading = false;
    connectEvents();
    if (!state.selectedProject && state.projects.length) {
      state.selectedProject = state.projects[0];
      renderWorkspace();
      await loadThreads(state.selectedProject, { selectFirst: true });
      return;
    }
    renderWorkspace();
  } catch (error) {
    state.projectsLoading = false;
    renderWorkspace();
    throw error;
  }
}

async function createThread(cwd, text = "", attachments = [], mentions = []) {
  await loadModels();
  const result = await fetchJson("/api/threads", {
    method: "POST",
    body: {
      cwd,
      text,
      attachments,
      mentions,
      model: state.selectedModel || undefined,
      effort: state.selectedEffort || undefined,
      approvalPolicy: approvalPolicyOverride(),
    },
  });
  const thread = extractCreatedThread(result, cwd);
  if (!thread?.id) throw new Error("Codex did not return a thread id for the new chat");
  state.thread = { ...thread, turns: [] };
  state.selectedThread = state.thread;
  rememberActiveThread(cwd, thread.id);
  await loadThread(thread.id);
}

function extractCreatedThread(result, fallbackCwd = null) {
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

function activeThreadStorageKey(cwd) {
  return `codexMobileActiveThread:${cwd || "unknown"}`;
}

function rememberActiveThread(cwd, threadId) {
  if (!cwd || !threadId) return;
  localStorage.setItem(activeThreadStorageKey(cwd), threadId);
}

async function loadThreads(project, options: AnyRecord = {}) {
  state.selectedProject = project;
  state.screen = "workspace";
  state.threadsLoading = true;
  state.threads = [];
  renderWorkspace();
  const query = new URLSearchParams({ cwd: project.cwd, limit: "100" });
  const result = await fetchJson(`/api/threads?${query.toString()}`);
  state.threads = result.data || [];
  state.threadsLoading = false;
  if (options.selectFirst && !state.thread && state.threads[0]) {
    const rememberedThreadId = localStorage.getItem(activeThreadStorageKey(project.cwd));
    const preferredThread = state.threads.find((thread) => thread.id === rememberedThreadId) || state.threads[0];
    await loadThread(preferredThread.id);
    return;
  }
  renderWorkspace();
}

async function loadThread(threadId) {
    state.changes = null;
    state.changesLoading = false;
    state.changesError = "";
    state.context = null;
  state.branches = null;
  state.tokenUsage = null;
  state.skills = [];
  state.attachments = [];
  state.composerMentions = [];
  state.uploadingAttachments = false;
  state.draftText = "";
  state.screen = "workspace";
  const [result] = await Promise.all([
    fetchJson(`/api/threads/${encodeURIComponent(threadId)}`),
    loadModels(),
  ]);
  state.thread = mergePendingLocalTurns(result.thread);
  state.selectedThread = state.thread;
  rememberActiveThread(state.thread?.cwd || state.selectedProject?.cwd, threadId);
  state.approvals.clear();
  if (!isWideScreen()) state.sidebarOpen = false;
  renderThread();
  subscribeThread(threadId);
  Promise.allSettled([
    loadThreadContext(threadId),
    loadBranches(threadId),
    loadTokenUsage(threadId),
    loadSkills(state.thread.cwd),
    loadChanges(threadId),
  ]).then(() => {
    if (state.thread?.id === threadId) renderThread();
  });
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

async function loadChanges(threadId, options: AnyRecord = {}) {
  if (!options.silent) {
    state.changesLoading = true;
    state.changesError = "";
    renderThread();
  }
  try {
    state.changes = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/changes`);
    state.changesError = "";
  } catch (error) {
    state.changesError = error.message || "Failed to load changes.";
    throw error;
  } finally {
    state.changesLoading = false;
  }
}

async function loadBranches(threadId) {
  state.branches = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/branches`);
}

async function loadTokenUsage(threadId) {
  const result = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/token-usage`);
  state.tokenUsage = result.tokenUsage || null;
}

async function loadSkills(cwd) {
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const result = await fetchJson(`/api/skills${query}`);
  state.skills = result.data || [];
}

async function sendMessage(text, attachmentsOverride = null, mentionsOverride = null) {
  const payloadAttachments = attachmentsOverride ? [...attachmentsOverride] : [...state.attachments];
  const payloadMentions = mentionsOverride ? [...mentionsOverride] : collectActiveMentions(text);
  if ((!text.trim() && !payloadAttachments.length && !payloadMentions.length) || !state.thread) return;
  const threadId = state.thread.id;
  state.attachments = [];
  state.composerMentions = [];
  state.draftText = "";
  state.followTail = true;
  const localTurnId = appendLocalUserMessage(text, payloadAttachments, payloadMentions);
  renderThread({ timelineOnly: true });
  scheduleThreadRefresh(threadId);
  startSlowStreamFallback(threadId);
  updateComposerSendMode();
  try {
    await fetchJson(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: {
        text,
        attachments: payloadAttachments,
        mentions: payloadMentions,
        model: state.selectedModel || undefined,
        effort: state.selectedEffort || undefined,
        approvalPolicy: approvalPolicyOverride(),
      },
    });
  } catch (error) {
    stopThreadRefresh();
    removeLocalTurn(localTurnId);
    renderThread({ timelineOnly: true });
    throw error;
  }
}

function enqueueMessage(text, attachments = [], mentions = []) {
  const trimmed = String(text || "").trim();
  if (!trimmed && !attachments.length) return;
  state.messageQueue.push({
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: trimmed,
    attachments: [...attachments],
    mentions: [...mentions],
    createdAt: Date.now(),
  });
}

function removeQueuedMessage(id) {
  state.messageQueue = state.messageQueue.filter((message) => message.id !== id);
}

function editQueuedMessage(id) {
  const queued = state.messageQueue.find((message) => message.id === id);
  if (!queued) return;
  removeQueuedMessage(id);
  state.draftText = queued.text;
  state.attachments = queued.attachments || [];
  state.composerMentions = queued.mentions || [];
  renderThread();
}

async function steerQueuedMessage(id) {
  const queued = state.messageQueue.find((message) => message.id === id);
  if (!queued || !state.thread) return;
  removeQueuedMessage(id);
  renderThread();
  try {
    await sendMessage(queued.text, queued.attachments || [], queued.mentions || []);
  } catch (error) {
    state.messageQueue.unshift(queued);
    renderThread();
    throw error;
  }
}

async function flushMessageQueue({ force = false } = {}) {
  if (!state.thread || (!force && isThreadBusy()) || !state.messageQueue.length) return;
  const [next] = state.messageQueue;
  removeQueuedMessage(next.id);
  renderThread();
  await sendMessage(next.text, next.attachments || [], next.mentions || []).catch((error) => {
    state.messageQueue.unshift(next);
    renderThread();
    alert(error.message);
  });
}

function startSlowStreamFallback(threadId) {
  window.setTimeout(() => {
    if (!state.thread || state.thread.id !== threadId || !isThreadBusy()) return;
    refreshThreadSnapshot(threadId).catch(() => {});
  }, 800);
}

function appendLocalUserMessage(text, attachments = [], mentions = []) {
  const trimmed = String(text || "").trim();
  const attachmentText = attachments.map((file) => `[${file.isImage ? "image" : "file"}] ${file.name}`).join("\n");
  const mentionText = mentions.map((mention) => `[${mention.kind === "skill" ? "skill" : "file"}] ${mention.name}`).join("\n");
  const displayText = [trimmed, attachmentText, mentionText].filter(Boolean).join("\n");
  if (!displayText || !state.thread) return null;
  const turnId = `local-${Date.now()}`;
  const turn = {
    id: turnId,
    threadId: state.thread.id,
    status: "queued",
    createdAt: Date.now(),
    items: [{
      id: `local-message-${Date.now()}`,
      type: "userMessage",
      text: displayText,
      attachments,
      local: true,
    }],
  };
  state.thread.turns ||= [];
  state.thread.turns.push(turn);
  state.pendingLocalTurns.push(turn);
  return turnId;
}

function removeLocalTurn(turnId) {
  if (!turnId || !state.thread?.turns) return;
  state.thread.turns = state.thread.turns.filter((turn) => turn.id !== turnId);
  state.pendingLocalTurns = state.pendingLocalTurns.filter((turn) => turn.id !== turnId);
}

function mergePendingLocalTurns(thread) {
  if (!thread) return thread;
  const turns = thread.turns || [];
  const pendingForThread = [];
  const now = Date.now();
  state.pendingLocalTurns = state.pendingLocalTurns.filter((turn) => {
    if (turn.threadId !== thread.id) return true;
    const text = extractText((turn.items || [])[0]).trim();
    const matched = text && turns.some((candidate) =>
      (candidate.items || []).some((item) => String(item?.type || item?.kind || "") === "userMessage" && extractText(item).trim() === text)
    );
    if (matched || now - Number(turn.createdAt || 0) > 120_000) return false;
    pendingForThread.push(turn);
    return true;
  });
  return pendingForThread.length ? { ...thread, turns: [...turns, ...pendingForThread] } : thread;
}

async function interruptThread() {
  if (!state.thread) return;
  const result = await fetchJson(`/api/threads/${encodeURIComponent(state.thread.id)}/interrupt`, {
    method: "POST",
    body: {},
  });
  await refreshThreadSnapshot(state.thread.id).catch(() => {});
  return result;
}

async function runThreadAction(action) {
  if (!state.thread) return;
  const body: AnyRecord = { action };
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
  state.screen = "settings";
  renderSettings();
}

export function backToWorkspace() {
  state.screen = "workspace";
  emit();
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    alert("이 브라우저는 알림을 지원하지 않습니다.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    state.notificationsEnabled = true;
    localStorage.setItem("codexMobileNotifications", "enabled");
    await notify("Codex Mobile", "알림이 켜졌습니다.", "codex-notifications-ready");
  } else {
    state.notificationsEnabled = false;
    localStorage.removeItem("codexMobileNotifications");
  }
  renderCurrentView();
}

async function notify(title, body, tag) {
  if (!state.notificationsEnabled || !("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body,
    tag,
    badge: "/icon.svg",
    icon: "/icon.svg",
    data: { url: location.href },
  };
  new Notification(title, options);
}

function notifyApproval(message) {
  const detail = summarizeApproval(message);
  notify("Codex needs approval", detail.detail || detail.title, `approval-${message.requestId}`);
}

function notifyTurnCompleted(event) {
  const title = state.thread?.name || state.thread?.preview || "Codex response finished";
  notify("Codex finished", title, `turn-${event.params?.turnId || Date.now()}`);
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
  state.ws.addEventListener("open", () => {
    state.wsReconnectAttempts = 0;
    if (state.thread?.id) subscribeThread(state.thread.id);
  });
  state.ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "approvalRequested") {
      state.approvals.set(message.requestId, message);
      notifyApproval(message);
      renderThread();
      return;
    }
    if (message.type !== "codexEvent") return;
    applyCodexEvent(message.event);
  });
  state.ws.addEventListener("close", scheduleEventReconnect);
  state.ws.addEventListener("error", scheduleEventReconnect);
}

function subscribeThread(threadId) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "subscribeThread", threadId }));
  } else {
    state.ws?.addEventListener("open", () => subscribeThread(threadId), { once: true });
  }
}

function scheduleEventReconnect() {
  if (!state.token || state.wsReconnectTimer) return;
  const delay = Math.min(10_000, 750 * (2 ** state.wsReconnectAttempts));
  state.wsReconnectAttempts += 1;
  state.wsReconnectTimer = window.setTimeout(() => {
    state.wsReconnectTimer = null;
    connectEvents();
    if (state.thread?.id && isThreadBusy()) {
      refreshThreadSnapshot(state.thread.id).catch(() => {});
    }
  }, delay);
}

function applyCodexEvent(event) {
  if (!state.thread || event.params?.threadId !== state.thread.id) return;
  const turns = state.thread.turns ||= [];
  let immediateRender = false;

  if (event.method === "turn/started") {
    const turn = event.params.turn || { id: event.params.turnId, items: [], status: "running" };
    if (!turns.some((candidate) => candidate?.id === turn.id)) turns.push(turn);
  }

  if (event.method === "item/started" || event.method === "item/completed") {
    let turn = turns.find((candidate) => candidate?.id === event.params.turnId);
    if (!turn) {
      turn = { id: event.params.turnId, items: [], status: "running" };
      turns.push(turn);
    }
    if (turn) {
      turn.items ||= [];
      const item = event.params.item;
      const index = turn.items.findIndex((candidate) => candidate?.id === item?.id);
      if (index >= 0) turn.items[index] = item;
      else turn.items.push(item);
    }
  }

  if (event.method === "item/agentMessage/delta") {
    let turn = turns.find((candidate) => candidate?.id === event.params.turnId);
    if (!turn) {
      turn = { id: event.params.turnId, items: [], status: "running" };
      turns.push(turn);
    }
    if (turn) {
      turn.items ||= [];
      let item = turn.items.find((candidate) => candidate?.id === event.params.itemId);
      if (!item) {
        item = { id: event.params.itemId, type: "agentMessage", text: "" };
        turn.items.push(item);
      }
      item.text = `${item.text || ""}${event.params.delta || ""}`;
    }
  }

  if (event.method === "turn/completed") {
    const turn = turns.find((candidate) => candidate?.id === event.params.turnId);
    if (turn) turn.status = event.params.turn?.status || "completed";
    state.pendingLocalTurns = state.pendingLocalTurns.filter((candidate) => candidate.threadId !== state.thread.id);
    stopThreadRefresh();
    notifyTurnCompleted(event);
    loadChanges(state.thread.id).then(() => renderThread()).catch(() => {});
    setTimeout(() => flushMessageQueue({ force: true }), 250);
    immediateRender = true;
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

  if (event.method === "thread/tokenUsage/updated") {
    state.tokenUsage = {
      turnId: event.params.turnId || null,
      tokenUsage: event.params.tokenUsage || null,
      updatedAt: Date.now(),
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

  scheduleRenderAfterEvent({ immediate: immediateRender });
}

function scheduleRenderAfterEvent({ immediate = false } = {}) {
  const timelineOnly = isComposerFocused() && state.activeTab === "chat";
  if (immediate) {
    if (state.renderTimer) window.clearTimeout(state.renderTimer);
    state.renderTimer = null;
    renderThread({ timelineOnly });
    updateComposerSendMode();
    return;
  }
  state.pendingRenderTimelineOnly = state.pendingRenderTimelineOnly && timelineOnly;
  if (state.renderTimer) return;
  state.renderTimer = window.setTimeout(() => {
    const shouldUseTimelineOnly = state.pendingRenderTimelineOnly;
    state.renderTimer = null;
    state.pendingRenderTimelineOnly = true;
    renderThread({ timelineOnly: shouldUseTimelineOnly });
    updateComposerSendMode();
  }, 50);
}

function scheduleThreadRefresh(threadId) {
  stopThreadRefresh();
  state.threadRefreshAttempts = 0;
  state.threadRefreshTimer = window.setInterval(async () => {
    if (!state.thread || state.thread.id !== threadId) {
      stopThreadRefresh();
      return;
    }
    state.threadRefreshAttempts += 1;
    if (state.threadRefreshAttempts > 24) {
      stopThreadRefresh();
      return;
    }
    await refreshThreadSnapshot(threadId).catch(() => {});
    if (isThreadIdle(state.thread)) {
      stopThreadRefresh();
      setTimeout(() => flushMessageQueue({ force: true }), 0);
    }
  }, 1500);
}

function stopThreadRefresh() {
  if (state.threadRefreshTimer) window.clearInterval(state.threadRefreshTimer);
  state.threadRefreshTimer = null;
  updateComposerSendMode();
}

async function refreshThreadSnapshot(threadId) {
  const result = await fetchJson(`/api/threads/${encodeURIComponent(threadId)}`);
  if (state.thread?.id !== threadId) return;
  state.thread = mergePendingLocalTurns(result.thread);
  state.selectedThread = state.thread;
  renderThread({ timelineOnly: isComposerFocused() && state.activeTab === "chat" });
}

function isThreadIdle(thread) {
  const status = formatThreadStatus(thread?.status).toLowerCase();
  if (status && !/(running|working|queued|pending|active)/.test(status)) return true;
  const turns = thread?.turns || [];
  const lastTurn = turns[turns.length - 1];
  const turnStatus = formatThreadStatus(lastTurn?.status).toLowerCase();
  return Boolean(turnStatus && !/(running|working|queued|pending|active)/.test(turnStatus));
}

function renderProjects() {
  emit();
}

function renderThreads() {
  emit();
}

function renderThread(options: AnyRecord = {}) {
  void options;
  emit();
}

function renderWorkspace() {
  emit();
}

function renderHeaderChangesButton() {
  if (!state.thread) return "";
  const count = state.changes?.summary?.filesChanged || 0;
  if (!count) return "";
  return `
    <button class="header-change-button" data-header-changes type="button" aria-label="Changed files">
      <span>${count}</span>
    </button>
  `;
}

function renderSidebar() {
  return `
    <aside class="app-sidebar" aria-label="Chats">
      <div class="sidebar-header">
        <div>
          <strong>Codex</strong>
          <span>${state.projects.length} projects</span>
        </div>
        <button class="icon-button sidebar-close" data-close-sidebar type="button" aria-label="Close chats">${uiIcon("close")}</button>
      </div>
      <label class="project-picker">
        <span>Project</span>
        <select id="project-select" aria-label="Project" ${state.projectsLoading ? "disabled" : ""}>
          ${state.projects.map((project) => `<option value="${escapeAttr(project.cwd)}" ${project.cwd === state.selectedProject?.cwd ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
        </select>
      </label>
      <div class="sidebar-tools">
        <input id="thread-search" value="${escapeAttr(state.threadSearch)}" placeholder="Search chats" />
        <button class="ghost-button compact new-session-button" data-new-thread type="button">${uiIcon("plus")}<span>New session</span></button>
      </div>
      <div class="thread-list">
        ${renderThreadList()}
      </div>
      ${renderSidebarFooter()}
    </aside>
  `;
}

function renderSidebarFooter() {
  const count = state.changes?.summary?.filesChanged || 0;
  return `
    <div class="sidebar-footer">
      <button class="sidebar-action ${state.activeTab === "chat" ? "active" : ""}" data-sidebar-tab="chat" type="button" ${state.thread ? "" : "disabled"}>
        ${uiIcon("chat")}
        <span>Chat</span>
      </button>
      <button class="sidebar-action ${state.activeTab === "changes" ? "active" : ""}" data-sidebar-tab="changes" type="button" ${state.thread ? "" : "disabled"}>
        ${uiIcon("changes")}
        <span>Changes</span>
        ${count ? `<strong>${count}</strong>` : ""}
      </button>
      <button class="sidebar-action" data-settings type="button">
        ${uiIcon("settings")}
        <span>Settings</span>
      </button>
    </div>
  `;
}

function renderThreadList() {
  const threads = filteredThreads();
  return `
    ${!state.projectsLoading && !state.threadsLoading ? `<div class="sidebar-section-label"><span>Recents</span><strong>${threads.length}</strong></div>` : ""}
    ${state.projectsLoading ? renderThreadSkeletons("Loading projects...") : ""}
    ${state.threadsLoading ? renderThreadSkeletons("Loading chats...") : ""}
    ${!state.projectsLoading && !state.threadsLoading && threads.map(renderThreadListItem).join("")}
    ${!state.projectsLoading && !state.threadsLoading && !threads.length ? `<p class="empty-state compact-empty">${state.threadSearch ? "No matching chats." : "No chats in this project."}</p>` : ""}
  `;
}

function renderThreadSkeletons(label) {
  return `
    <div class="sidebar-section-label loading-label"><span>${escapeHtml(label)}</span></div>
    ${Array.from({ length: 4 }).map(() => `
      <div class="thread-item skeleton-thread" aria-hidden="true">
        <strong></strong>
        <span></span>
      </div>
    `).join("")}
  `;
}

function renderThreadListItem(thread) {
  const active = thread.id === state.thread?.id;
  const status = formatThreadStatus(thread.status);
  const label = formatThreadListLabel(thread);
  const tone = threadStatusTone(status);
  return `
    <button class="thread-item ${active ? "active" : ""}" data-thread-id="${escapeAttr(thread.id)}" type="button" ${active ? `aria-current="true"` : ""} title="${escapeAttr(thread.name || thread.title || thread.preview || "Untitled")}">
      <strong>${escapeHtml(thread.name || thread.title || thread.preview || "Untitled")}</strong>
      <span class="thread-meta">
        <span class="thread-status ${escapeAttr(tone)}">${escapeHtml(label)}</span>
        ${thread.updatedAt || thread.createdAt ? `<time>${escapeHtml(formatDate(thread.updatedAt || thread.createdAt))}</time>` : ""}
      </span>
    </button>
  `;
}

function renderMainPane() {
  if (state.projectsLoading) {
    return `<div class="main-scroll workspace-empty"><p class="empty-state">Loading Codex workspace...</p></div>`;
  }
  if (!state.selectedProject) {
    return `<div class="main-scroll workspace-empty"><p class="empty-state">No Codex projects found.</p></div>`;
  }
  if (!state.thread) {
    if (state.startPendingMessage) {
      return `
        <div class="main-scroll timeline">
          ${renderChatContents([{
            id: "start-pending",
            status: "running",
            items: [{
              type: "userMessage",
              text: [state.startPendingMessage.text, ...(state.startPendingMessage.mentions || []).map((mention) => `[${mention.kind === "skill" ? "skill" : "file"}] ${mention.name}`)].filter(Boolean).join("\n"),
              attachments: state.startPendingMessage.attachments,
              local: true,
            }],
          }])}
        </div>
        ${renderComposer()}
      `;
    }
    return `
      <div class="main-scroll start-pane">
        <div class="start-shell">
          <h1>${escapeHtml(state.selectedProject.name)}에서 무엇을 구축할까요?</h1>
          ${renderComposer({ start: true })}
          ${renderStartSuggestions()}
        </div>
      </div>
    `;
  }
  const turns = state.thread.turns || [];
  const content = state.activeTab === "changes" ? renderChanges() : renderChat(turns);
  return `
    ${content}
    ${state.activeTab === "chat" ? renderComposer() : ""}
  `;
}

function filteredThreads() {
  const query = state.threadSearch.trim().toLowerCase();
  if (!query) return state.threads;
  return state.threads.filter((thread) => {
    const haystack = `${thread.name || ""} ${thread.title || ""} ${thread.preview || ""} ${formatThreadStatus(thread.status)}`.toLowerCase();
    return haystack.includes(query);
  });
}

function bindWorkspaceControls() {
  app.querySelector("[data-toggle-sidebar]")?.addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    renderWorkspace();
  });
  app.querySelectorAll<HTMLElement>("[data-close-sidebar]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sidebarOpen = false;
      renderWorkspace();
    });
  });
  app.querySelector("#project-select")?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    const project = state.projects.find((candidate) => candidate.cwd === value);
    if (!project) return;
    state.thread = null;
    state.selectedThread = null;
    state.threadSearch = "";
    state.activeTab = "chat";
    loadThreads(project, { selectFirst: true }).catch((error) => alert(error.message));
  });
  app.querySelector("#thread-search")?.addEventListener("input", (event) => {
    state.threadSearch = (event.target as HTMLInputElement).value;
    const list = app.querySelector(".thread-list") as HTMLElement | null;
    if (list) list.innerHTML = renderThreadList();
    bindThreadRows();
  });
  bindThreadRows();
  app.querySelectorAll<HTMLElement>("[data-new-thread]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!state.selectedProject) return;
      state.thread = null;
      state.selectedThread = null;
      state.activeTab = "chat";
      if (!isWideScreen()) state.sidebarOpen = false;
      renderWorkspace();
      setTimeout(() => (app.querySelector("#message-input") as HTMLTextAreaElement | null)?.focus(), 0);
    });
  });
  app.querySelectorAll<HTMLElement>("[data-sidebar-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.sidebarTab;
      if (!isWideScreen()) state.sidebarOpen = false;
      if (state.activeTab === "changes" && !state.changes && state.thread) {
        renderWorkspace();
        loadChanges(state.thread.id).catch(() => renderWorkspace());
        return;
      }
      renderWorkspace();
    });
  });
  app.querySelector("[data-header-changes]")?.addEventListener("click", () => {
    state.activeTab = "changes";
    renderWorkspace();
    if (state.thread && !state.changes) loadChanges(state.thread.id).catch(() => renderWorkspace());
  });
  app.querySelector("[data-settings]")?.addEventListener("click", () => loadSettings().catch((error) => alert(error.message)));
  if (state.activeTab === "chat" && state.selectedProject) bindThreadControls();
}

function bindThreadRows() {
  app.querySelectorAll<HTMLElement>("[data-thread-id]").forEach((row) => {
    row.addEventListener("click", () => loadThread(row.dataset.threadId).catch((error) => alert(error.message)));
  });
}

function renderChat(turns) {
  return `
    <div class="main-scroll timeline">
      ${renderChatContents(turns)}
    </div>
  `;
}

function renderChatContents(turns = state.thread?.turns || []) {
  return `
    ${turns.flatMap((turn) => turn.items || []).map(renderItem).join("")}
    ${renderThinkingIndicator(turns)}
    ${renderQueuedMessages()}
    ${[...state.approvals.values()].map(renderApproval).join("")}
  `;
}

function renderStartSuggestions() {
  const suggestions = [
    "현재 프로젝트 구조를 파악하고 다음 작업을 제안해줘",
    "변경 사항을 검토하고 위험한 부분을 찾아줘",
    "테스트를 실행하고 실패하면 고쳐줘",
  ];
  return `
      <div class="start-suggestions" aria-label="Suggested prompts">
      ${suggestions.map((text) => `
        <button data-start-prompt="${escapeAttr(text)}" type="button">
          <span>${uiIcon("spark")}</span>
          <strong>${escapeHtml(text)}</strong>
        </button>
      `).join("")}
    </div>
  `;
}

function renderThinkingIndicator(turns = []) {
  if (!isThreadBusy()) return "";
  const lastTurn = turns[turns.length - 1];
  const hasOpenAgentMessage = (lastTurn?.items || []).some((item) => {
    const type = String(item?.type || item?.itemType || "");
    return type === "agentMessage" && extractText(item).trim();
  });
  if (hasOpenAgentMessage) return "";
  return `<div class="message agent thinking" aria-live="polite"><span class="thinking-dots"><i></i><i></i><i></i></span><span>Codex가 작업 중입니다</span></div>`;
}

function renderQueuedMessages() {
  if (!state.messageQueue.length) return "";
  return `
    <section class="queued-card" aria-label="Queued messages">
      <strong>${state.messageQueue.length} queued</strong>
      ${state.messageQueue.map((message, index) => `
        <div class="queued-message">
          <span>${index + 1}.</span>
          <p>${escapeHtml(message.text || summarizeAttachments(message.attachments))}</p>
          <div>
            <button class="queue-action" data-queue-steer="${escapeAttr(message.id)}" type="button">${uiIcon("send")}<span>바로 보내기</span></button>
            <button class="queue-action" data-queue-edit="${escapeAttr(message.id)}" type="button">${uiIcon("edit")}<span>편집</span></button>
            <button class="queue-action danger" data-queue-delete="${escapeAttr(message.id)}" type="button">${uiIcon("trash")}<span>삭제</span></button>
          </div>
        </div>
      `).join("")}
    </section>
  `;
}

function summarizeAttachments(attachments = []) {
  return attachments.map((file) => file.name).filter(Boolean).join(", ") || "Attachment";
}

function renderTimelineOnly() {
  const timeline = app.querySelector(".timeline") as HTMLElement | null;
  if (!timeline || !state.thread) return false;
  const shouldFollow = state.followTail || isNearBottom(timeline);
  timeline.innerHTML = renderChatContents(state.thread.turns || []);
  if (shouldFollow) timeline.scrollTop = timeline.scrollHeight;
  return true;
}

function syncComposerChrome() {
  const host = app.querySelector("#attachment-tray-host");
  if (host) host.innerHTML = renderAttachmentTray();
  updateComposerSendMode();
}

function updateComposerSendMode() {
  const button = app.querySelector(".composer-send") as HTMLButtonElement | null;
  if (!button) return;
  const hasDraft = Boolean(state.draftText.trim() || state.attachments.length);
  const stopInsteadOfSend = isThreadBusy() && !hasDraft;
  button.textContent = stopInsteadOfSend ? "■" : "↑";
  button.classList.toggle("stop", stopInsteadOfSend);
  button.setAttribute("aria-label", stopInsteadOfSend ? "Stop" : "Send");
}

function isThreadBusy() {
  if (state.creatingThread) return true;
  if (!state.thread) return false;
  const status = formatThreadStatus(state.thread.status).toLowerCase();
  if (/(running|working|queued|pending|active)/.test(status)) return true;
  const turns = state.thread.turns || [];
  const lastTurn = turns[turns.length - 1];
  const turnStatus = formatThreadStatus(lastTurn?.status).toLowerCase();
  if (/(running|working|queued|pending|active)/.test(turnStatus)) return true;
  return Boolean(state.threadRefreshTimer);
}

function isComposerFocused() {
  return document.activeElement?.id === "message-input";
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 80;
}

function captureRenderState() {
  const timeline = app.querySelector(".timeline") as HTMLElement | null;
  const input = app.querySelector("#message-input") as HTMLTextAreaElement | null;
  return {
    timelineTop: timeline?.scrollTop || 0,
    wasNearBottom: timeline ? isNearBottom(timeline) : state.followTail,
    inputFocused: document.activeElement === input,
    selectionStart: input?.selectionStart || 0,
    selectionEnd: input?.selectionEnd || 0,
  };
}

function restoreRenderState(previous) {
  const timeline = app.querySelector(".timeline") as HTMLElement | null;
  if (timeline) {
    const shouldFollow = state.followTail && previous.wasNearBottom;
    if (shouldFollow) timeline.scrollTop = timeline.scrollHeight;
    else timeline.scrollTop = previous.timelineTop;
  }
  const input = app.querySelector("#message-input") as HTMLTextAreaElement | null;
  if (previous.inputFocused && input) {
    input.focus();
    input.setSelectionRange(previous.selectionStart, previous.selectionEnd);
  }
}

function renderComposer(options: AnyRecord = {}) {
  const hasDraft = Boolean(state.draftText.trim() || state.attachments.length);
  const stopInsteadOfSend = isThreadBusy() && !hasDraft;
  const className = options.start ? "composer start-composer" : "composer";
  const placeholder = options.start
    ? "Codex에게 뭐든 물어보세요. @파일, $skill, /명령"
    : "Codex에게 메시지 보내기";
  return `
    <div class="skill-picker" id="composer-suggestions" hidden></div>
    <form class="${className}" id="composer">
      <div id="attachment-tray-host">${renderAttachmentTray()}</div>
      <textarea id="message-input" placeholder="${escapeAttr(placeholder)}">${escapeHtml(state.draftText)}</textarea>
      <div class="composer-controls">
        <div class="composer-left">
          <button class="composer-icon" data-attach type="button" aria-label="Attach file">${uiIcon("plus")}</button>
          <button class="permission-pill ${state.openComposerMenu === "permission" ? "open" : ""}" data-menu-toggle="permission" type="button" aria-label="Permissions" aria-expanded="${state.openComposerMenu === "permission" ? "true" : "false"}">
            ${uiIcon("shield")}
            ${escapeHtml(currentPermissionOption().label)}
            <span>${uiIcon("chevronDown")}</span>
          </button>
        </div>
        <div class="composer-right">
          ${renderTokenDial()}
          <button class="model-pill ${state.openComposerMenu === "model" ? "open" : ""}" data-menu-toggle="model" type="button" aria-label="Model and reasoning" aria-expanded="${state.openComposerMenu === "model" ? "true" : "false"}">
            ${uiIcon("brain")}
            <strong>${escapeHtml(formatModelLabel(state.selectedModel || state.modelConfig?.model || "default"))}</strong>
            <span>${escapeHtml(formatEffortLabel(state.selectedEffort || ""))}</span>
            <i>${uiIcon("chevronDown")}</i>
          </button>
          <button class="composer-send ${stopInsteadOfSend ? "stop" : ""}" aria-label="${stopInsteadOfSend ? "Stop" : "Send"}" ${state.uploadingAttachments ? "disabled" : ""}>${stopInsteadOfSend ? uiIcon("stop") : uiIcon("send")}</button>
        </div>
      </div>
      ${renderComposerMenu()}
      <div class="composer-footer">
        <span>${escapeHtml(state.selectedProject?.name || "Project")}</span>
        <span>로컬 Codex 세션</span>
        ${renderBranchSelect()}
      </div>
      <input id="file-input" type="file" multiple hidden accept="${escapeAttr(FILE_ATTACHMENT_ACCEPT)}" />
    </form>
  `;
}

function bindThreadControls() {
  app.querySelector("#composer")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = app.querySelector("#message-input") as HTMLTextAreaElement;
    const text = input.value;
    if (!text.trim() && !state.attachments.length && !state.composerMentions.length && isThreadBusy()) {
      await interruptThread().catch((error) => alert(error.message));
      return;
    }
    const attachments = [...state.attachments];
    const mentions = collectActiveMentions(text);
    input.value = "";
    state.draftText = "";
    state.attachments = [];
    state.composerMentions = [];
    hideComposerSuggestions();
    if (state.creatingThread) {
      if (text.trim() || attachments.length || mentions.length) {
        enqueueMessage(text, attachments, mentions);
        renderWorkspace();
      } else {
        syncComposerChrome();
      }
      return;
    }
    if (!state.thread) {
      if (!text.trim() && !attachments.length && !mentions.length) {
        syncComposerChrome();
        return;
      }
      state.creatingThread = true;
      state.startPendingMessage = { text, attachments, mentions };
      renderWorkspace();
      try {
        await createThread(state.selectedProject.cwd, text, attachments, mentions);
      } catch (error) {
        state.creatingThread = false;
        state.startPendingMessage = null;
        state.draftText = text;
        state.attachments = attachments;
        state.composerMentions = mentions;
        renderWorkspace();
        alert(error.message);
        return;
      }
      state.creatingThread = false;
      state.startPendingMessage = null;
      flushMessageQueue().catch((error) => alert(error.message));
      return;
    }
    if (isThreadBusy()) {
      enqueueMessage(text, attachments, mentions);
      renderThread({ timelineOnly: true });
      syncComposerChrome();
      return;
    }
    try {
      await sendMessage(text, attachments, mentions);
    } catch (error) {
      state.draftText = text;
      state.composerMentions = mentions;
      renderThread();
      alert(error.message);
    }
  });
  const messageInput = app.querySelector("#message-input") as HTMLTextAreaElement | null;
  messageInput?.addEventListener("input", () => {
    state.draftText = messageInput.value;
    pruneComposerMentions(messageInput.value);
    updateComposerSuggestions(messageInput);
    updateComposerSendMode();
  });
  messageInput?.addEventListener("selectionchange", () => updateComposerSuggestions(messageInput));
  const fileInput = app.querySelector("#file-input") as HTMLInputElement | null;
  app.querySelector("[data-attach]")?.addEventListener("click", () => fileInput?.click());
  const handleFileInputChange = async (event) => {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files || []);
    target.value = "";
    if (!files.length) return;
    await uploadAttachments(files).catch((error) => alert(error.message));
  };
  fileInput?.addEventListener("change", handleFileInputChange);
  app.querySelectorAll<HTMLElement>("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.attachments = state.attachments.filter((attachment) => attachment.id !== button.dataset.removeAttachment);
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-remove-mention]").forEach((button) => {
    button.addEventListener("click", () => {
      state.composerMentions = state.composerMentions.filter((mention) => mention.id !== button.dataset.removeMention);
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-start-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = app.querySelector("#message-input") as HTMLTextAreaElement | null;
      state.draftText = button.dataset.startPrompt || "";
      if (input) {
        input.value = state.draftText;
        input.focus();
      }
      updateComposerSendMode();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-approval]").forEach((button) => {
    button.addEventListener("click", () => {
      answerApproval(button.dataset.approval, button.dataset.decision, button.dataset.remember === "true");
    });
  });
  app.querySelectorAll<HTMLElement>("[data-queue-steer]").forEach((button) => {
    button.addEventListener("click", () => {
      steerQueuedMessage(button.dataset.queueSteer).catch((error) => alert(error.message));
    });
  });
  app.querySelectorAll<HTMLElement>("[data-queue-edit]").forEach((button) => {
    button.addEventListener("click", () => editQueuedMessage(button.dataset.queueEdit));
  });
  app.querySelectorAll<HTMLElement>("[data-queue-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      removeQueuedMessage(button.dataset.queueDelete);
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-menu-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      state.openComposerMenu = state.openComposerMenu === button.dataset.menuToggle ? null : button.dataset.menuToggle;
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-effort]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEffort = button.dataset.effort;
      localStorage.setItem("codexMobileEffort", state.selectedEffort);
      state.openComposerMenu = null;
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-model]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedModel = button.dataset.model;
      localStorage.setItem("codexMobileModel", state.selectedModel);
      const current = state.models.find((model) => model.model === state.selectedModel || model.id === state.selectedModel);
      if (current?.defaultReasoningEffort) {
        state.selectedEffort = current.defaultReasoningEffort;
        localStorage.setItem("codexMobileEffort", state.selectedEffort);
      }
      state.openComposerMenu = null;
      renderThread();
    });
  });
  app.querySelectorAll<HTMLElement>("[data-permission]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPermission = button.dataset.permission;
      localStorage.setItem("codexMobilePermission", state.selectedPermission);
      state.openComposerMenu = null;
      renderThread();
    });
  });
  app.querySelector("#branch-select")?.addEventListener("change", async (event) => {
    const value = (event.target as HTMLSelectElement).value;
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
    await loadChanges(state.thread.id).catch((error) => alert(error.message));
    renderThread();
  });
  app.querySelector("[data-back-chat]")?.addEventListener("click", () => {
    state.activeTab = "chat";
    renderThread();
  });
  app.querySelector("[data-commit-changes]")?.addEventListener("click", () => {
    commitChanges().catch((error) => alert(error.message));
  });
  app.querySelector("[data-interrupt]")?.addEventListener("click", () => {
    interruptThread().catch((error) => alert(error.message));
  });
  app.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      runThreadAction(button.dataset.action).catch((error) => alert(error.message));
    });
  });
  const scroll = app.querySelector(".main-scroll") as HTMLElement | null;
  if (scroll && state.activeTab === "chat") {
    scroll.addEventListener("scroll", () => {
      state.followTail = isNearBottom(scroll);
    }, { passive: true });
  }
}

function renderAttachmentTray() {
  if (!state.attachments.length && !state.composerMentions.length && !state.uploadingAttachments) return "";
  return `
    <div class="attachment-tray">
      ${state.composerMentions.map((mention) => `
        <span class="attachment-pill mention-pill">
          <span>${escapeHtml(`${mention.kind === "skill" ? "$" : "@"}${mention.name}`)}</span>
          <button data-remove-mention="${escapeAttr(mention.id)}" type="button" aria-label="Remove ${escapeAttr(mention.name)}">×</button>
        </span>
      `).join("")}
      ${state.attachments.map((attachment) => `
        <span class="attachment-pill">
          <span>${escapeHtml(attachment.name)}</span>
          <button data-remove-attachment="${escapeAttr(attachment.id)}" type="button" aria-label="Remove ${escapeAttr(attachment.name)}">×</button>
        </span>
      `).join("")}
      ${state.uploadingAttachments ? `<span class="attachment-pill loading">Uploading...</span>` : ""}
    </div>
  `;
}

function renderBranchSelect() {
  const git = state.context?.git || state.changes || state.thread?.gitInfo || {};
  const branchOptions = state.branches?.branches || [];
  const currentBranch = state.branches?.current || git.branch || state.thread?.gitInfo?.branch || "none";
  return `
    <label class="branch-pill">
      <select id="branch-select" aria-label="Branch">
        ${branchOptions.map((branch) => `<option value="${escapeAttr(branch.name)}" ${branch.name === currentBranch ? "selected" : ""}>${escapeHtml(branch.name)}</option>`).join("") || `<option>${escapeHtml(currentBranch)}</option>`}
        <option value="__create__">New branch...</option>
      </select>
    </label>
  `;
}

function renderComposerMenu() {
  if (state.openComposerMenu === "model") return renderModelMenu();
  if (state.openComposerMenu === "permission") return renderPermissionMenu();
  return "";
}

function renderModelMenu() {
  const selectedModel = state.selectedModel || state.modelConfig?.model || "";
  return `
    <div class="composer-menu model-menu">
      <span class="menu-title">${uiIcon("brain")}<span>인텔리전스</span></span>
      ${currentEfforts().map((effort) => `
        <button class="menu-option ${effort === state.selectedEffort ? "selected" : ""}" data-effort="${escapeAttr(effort)}" type="button" role="menuitemradio" aria-checked="${effort === state.selectedEffort ? "true" : "false"}">
          <span>${escapeHtml(formatEffortLabel(effort))}</span>
          ${effort === state.selectedEffort ? `<strong>${uiIcon("check")}</strong>` : ""}
        </button>
      `).join("")}
      <hr />
      ${state.models.map((item) => {
        const value = item.model || item.id;
        return `
          <button class="menu-option ${value === selectedModel ? "selected" : ""}" data-model="${escapeAttr(value)}" type="button" role="menuitemradio" aria-checked="${value === selectedModel ? "true" : "false"}">
            <span>${escapeHtml(item.displayName || formatModelLabel(value))}</span>
            ${value === selectedModel ? `<strong>${uiIcon("check")}</strong>` : `<i>${uiIcon("chevronRight")}</i>`}
          </button>
        `;
      }).join("") || `
        <button class="menu-option selected" type="button">
          <span>${escapeHtml(formatModelLabel(selectedModel || "default"))}</span>
          <strong>${uiIcon("check")}</strong>
        </button>
      `}
    </div>
  `;
}

function renderPermissionMenu() {
  return `
    <div class="composer-menu permission-menu">
      ${permissionOptions().map((option) => `
        <button class="menu-option permission-option ${option.value === state.selectedPermission ? "selected" : ""}" data-permission="${escapeAttr(option.value)}" type="button" role="menuitemradio" aria-checked="${option.value === state.selectedPermission ? "true" : "false"}">
          <span>${escapeHtml(option.label)}</span>
          ${option.value === state.selectedPermission ? `<strong>${uiIcon("check")}</strong>` : ""}
        </button>
      `).join("")}
    </div>
  `;
}

async function uploadAttachments(files) {
  state.uploadingAttachments = true;
  renderThread();
  try {
    const payloadFiles = await Promise.all(files.map(readUploadFile));
    const result = await fetchJson("/api/uploads", {
      method: "POST",
      body: { files: payloadFiles },
    });
    const enriched = (result.files || []).map((file, index) => ({
      ...file,
      previewUrl: payloadFiles[index]?.mime?.startsWith("image/") ? payloadFiles[index].data : null,
    }));
    enriched.forEach((file) => {
      if (file.path && file.id) state.previewIdsByPath[file.path] = file.id;
    });
    state.attachments = [...state.attachments, ...enriched];
  } finally {
    state.uploadingAttachments = false;
    renderThread();
  }
}

function readUploadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve({
      name: file.name,
      mime: file.type || "application/octet-stream",
      data: String(reader.result || ""),
    });
    reader.readAsDataURL(file);
  });
}

function updateComposerSuggestions(input) {
  const token = getComposerToken(input);
  if (!token) {
    hideComposerSuggestions();
    return;
  }
  if (token.kind === "skill") {
    renderSkillSuggestions(input, token);
    return;
  }
  if (token.kind === "slash") {
    renderSlashSuggestions(input, token);
    return;
  }
  renderMentionSuggestions(input, token);
}

function getComposerToken(input) {
  const cursor = input.selectionStart || 0;
  const before = input.value.slice(0, cursor);
  const match = before.match(/(^|\s)([$@/])([^\s$@/]*)$/);
  if (!match) return null;
  const symbol = match[2];
  return {
    kind: symbol === "$" ? "skill" : symbol === "@" ? "mention" : "slash",
    symbol,
    start: cursor - match[3].length - 1,
    end: cursor,
    query: match[3],
  };
}

function suggestionPicker() {
  return app.querySelector("#composer-suggestions") as HTMLElement | null;
}

function hideComposerSuggestions() {
  state.suggestionSeq += 1;
  const picker = suggestionPicker();
  if (picker) picker.hidden = true;
}

function renderSkillSuggestions(input, token) {
  const picker = suggestionPicker();
  if (!picker) return;
  const query = token.query.toLowerCase();
  const matches = state.skills
    .filter((skill) => `${skill.name || ""} ${skill.description || ""}`.toLowerCase().includes(query))
    .slice(0, 8);
  picker.hidden = false;
  picker.innerHTML = renderSuggestionList("Skills", matches.length ? "Tap to insert" : "No installed skills found", matches.map((skill) => ({
    kind: "skill",
    id: skill.name,
    title: `$${skill.name}`,
    subtitle: skill.description || "",
  })));
  bindSuggestionButtons(input, token);
}

async function renderMentionSuggestions(input, token) {
  const picker = suggestionPicker();
  if (!picker) return;
  picker.hidden = false;
  picker.innerHTML = renderSuggestionList("Agents", "Searching agents and files", []);
  const sequence = ++state.suggestionSeq;
  const query = new URLSearchParams({
    cwd: state.selectedProject?.cwd || state.thread?.cwd || "",
    query: token.query,
  });
  const result = await fetchJson(`/api/mentions?${query.toString()}`).catch((error) => ({ error: error.message, agents: [], files: [], plugins: [], apps: [] }));
  if (sequence !== state.suggestionSeq) return;
  const items = [
    ...(result.agents || []).map((agent) => ({
      kind: "agent",
      id: agent.name,
      title: `@${agent.name}`,
      subtitle: agent.description || agent.model || "Agent",
      name: agent.name,
      path: agent.path || "",
    })),
    ...(result.files || []).map((file) => ({
      kind: "file",
      id: file.absolutePath,
      title: `@${file.name}`,
      subtitle: file.path,
      path: file.absolutePath,
      root: file.root,
      name: file.name,
    })),
    ...(result.apps || []).map((item) => ({
      kind: "app",
      id: item.id || item.name,
      title: `@${item.name || item.id}`,
      subtitle: item.description || "App",
      name: item.name || item.id,
    })),
    ...(result.plugins || []).map((item) => ({
      kind: "plugin",
      id: item.id || item.name,
      title: `@${item.displayName || item.name}`,
      subtitle: item.description || "Plugin",
      name: item.displayName || item.name,
    })),
  ].slice(0, 18);
  picker.innerHTML = renderSuggestionList("Agents", items.length ? "Agents, files, apps" : "No results", items);
  bindSuggestionButtons(input, token);
}

function renderSlashSuggestions(input, token) {
  const picker = suggestionPicker();
  if (!picker) return;
  const query = token.query.toLowerCase();
  const matches = slashCommands()
    .filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(query))
    .slice(0, 10);
  picker.hidden = false;
  picker.innerHTML = renderSuggestionList("Slash commands", matches.length ? "Tap to run" : "No commands", matches.map((command) => ({
    kind: "slash",
    id: command.name,
    title: `/${command.name}`,
    subtitle: command.description,
  })));
  bindSuggestionButtons(input, token);
}

function renderSuggestionList(title, subtitle, items) {
  return `
    <div class="skill-picker-header">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(subtitle)}</span>
    </div>
    ${items.map((item) => `
      <button class="skill-option" data-suggestion-kind="${escapeAttr(item.kind)}" data-suggestion-id="${escapeAttr(item.id || "")}" data-suggestion-name="${escapeAttr(item.name || item.id || "")}" data-suggestion-path="${escapeAttr(item.path || "")}" data-suggestion-root="${escapeAttr(item.root || "")}" type="button">
        <strong>${escapeHtml(item.title)}</strong>
        ${item.subtitle ? `<span>${escapeHtml(item.subtitle)}</span>` : ""}
      </button>
    `).join("")}
  `;
}

function bindSuggestionButtons(input, token) {
  const picker = suggestionPicker();
  if (picker) {
    picker.onwheel = (event) => event.stopPropagation();
    picker.ontouchmove = (event) => event.stopPropagation();
  }
  picker?.querySelectorAll<HTMLElement>("[data-suggestion-kind]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const kind = button.dataset.suggestionKind;
      if (kind === "slash") {
        runSlashCommand(input, token, button.dataset.suggestionId);
        return;
      }
      if (kind === "file") {
        insertMentionToken(input, token, {
          kind: "file",
          name: button.dataset.suggestionName || pathBasename(button.dataset.suggestionPath),
          path: button.dataset.suggestionPath,
          root: button.dataset.suggestionRoot,
        });
        return;
      }
      if (kind === "skill") {
        insertSkillToken(input, token, button.dataset.suggestionName, button.dataset.suggestionPath || "");
        return;
      }
      insertPlainToken(input, token, `@${button.dataset.suggestionName || button.dataset.suggestionId} `);
    });
  });
}

function insertSkillToken(input, token, skillName, skillPath = "") {
  if (!skillName) return;
  state.composerMentions.push({
    id: `skill-${skillName}-${Date.now()}`,
    kind: "skill",
    name: skillName,
    path: skillPath,
  });
  insertPlainToken(input, token, `$${skillName} `);
}

function insertMentionToken(input, token, mention) {
  if (!mention.path) return;
  state.composerMentions.push({
    id: `mention-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...mention,
  });
  insertPlainToken(input, token, `@${mention.name} `);
}

function insertPlainToken(input, token, inserted) {
  const before = input.value.slice(0, token.start);
  const after = input.value.slice(token.end);
  input.value = `${before}${inserted}${after}`;
  const cursor = before.length + inserted.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  state.draftText = input.value;
  hideComposerSuggestions();
  syncComposerChrome();
}

function collectActiveMentions(text) {
  const current = String(text || "");
  return state.composerMentions.filter((mention) => {
    const marker = `${mention.kind === "skill" ? "$" : "@"}${mention.name}`;
    return current.includes(marker);
  });
}

function pruneComposerMentions(text) {
  const active = collectActiveMentions(text);
  if (active.length === state.composerMentions.length) return;
  state.composerMentions = active;
  syncComposerChrome();
}

function slashCommands() {
  return [
    { name: "compact", description: "현재 thread context를 압축합니다.", action: "compact" },
    { name: "fork", description: "현재 thread를 새 thread로 fork합니다.", action: "fork" },
    { name: "model", description: "모델과 reasoning 선택 메뉴를 엽니다.", action: "model" },
    { name: "reasoning", description: "reasoning effort 선택 메뉴를 엽니다.", action: "model" },
    { name: "status", description: "계정, 모델, MCP, skill 상태를 엽니다.", action: "settings" },
    { name: "changes", description: "현재 변경 파일을 확인합니다.", action: "changes" },
    { name: "new", description: "현재 프로젝트에서 새 채팅을 시작합니다.", action: "new" },
    { name: "skills", description: "설치된 skill을 확인합니다.", action: "settings" },
    { name: "mcp", description: "MCP 서버 상태를 확인합니다.", action: "settings" },
  ];
}

function runSlashCommand(input, token, name) {
  const command = slashCommands().find((item) => item.name === name);
  if (!command) return;
  insertPlainToken(input, token, "");
  if (command.action === "compact" || command.action === "fork") {
    if (state.thread) runThreadAction(command.action).catch((error) => alert(error.message));
    return;
  }
  if (command.action === "model") {
    state.openComposerMenu = "model";
    renderThread();
    return;
  }
  if (command.action === "settings") {
    loadSettings().catch((error) => alert(error.message));
    return;
  }
  if (command.action === "changes") {
    state.activeTab = "changes";
    if (state.thread && !state.changes) loadChanges(state.thread.id).then(() => renderThread()).catch((error) => alert(error.message));
    else renderThread();
    return;
  }
  if (command.action === "new") {
    state.thread = null;
    state.selectedThread = null;
    state.activeTab = "chat";
    renderWorkspace();
  }
}

function tokenUsageMetrics() {
  const usage = state.tokenUsage?.tokenUsage || state.tokenUsage;
  const total = usage?.total || null;
  const totalTokens = Number(firstNumber(
    total?.totalTokens,
    total?.tokens,
    total?.total_tokens,
    usage?.totalTokens,
    usage?.total_tokens,
    usage?.tokens,
  )) || sumNumbers(
    total?.inputTokens,
    total?.cachedInputTokens,
    total?.outputTokens,
    total?.reasoningOutputTokens,
    usage?.inputTokens,
    usage?.cachedInputTokens,
    usage?.outputTokens,
    usage?.reasoningOutputTokens,
    usage?.input_tokens,
    usage?.cached_input_tokens,
    usage?.output_tokens,
    usage?.reasoning_output_tokens,
  );
  const contextWindow = modelContextWindow(usage);
  const percent = contextWindow ? Math.min(100, Math.round((totalTokens / contextWindow) * 100)) : 0;
  const remaining = contextWindow ? Math.max(0, contextWindow - totalTokens) : null;
  return { usage, total, totalTokens, contextWindow, percent, remaining };
}

function modelContextWindow(usage) {
  const selected = state.models.find((model) => model.model === state.selectedModel || model.id === state.selectedModel) || {};
  return firstNumber(
    usage?.modelContextWindow,
    usage?.contextWindow,
    usage?.context_window,
    state.context?.config?.modelContextWindow,
    state.context?.config?.contextWindow,
    state.context?.config?.modelAutoCompactTokenLimit,
    state.modelConfig?.modelContextWindow,
    state.modelConfig?.contextWindow,
    state.modelConfig?.modelAutoCompactTokenLimit,
    selected.modelContextWindow,
    selected.contextWindow,
    selected.contextWindowTokens,
    selected.context_window,
    selected.limits?.contextWindow,
    selected.modelAutoCompactTokenLimit,
    selected.limits?.modelAutoCompactTokenLimit,
    selected.limits?.autoCompactTokenLimit,
    inferredModelContextWindow(),
  );
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numericValue(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function sumNumbers(...values) {
  return values.reduce((sum, value) => {
    const number = numericValue(value);
    return Number.isFinite(number) && number > 0 ? sum + number : sum;
  }, 0);
}

function numericValue(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);
  const text = value.trim().toLowerCase().replace(/,/g, "");
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmg])?/);
  if (!match) return Number(value);
  const base = Number(match[1]);
  const multiplier = match[2] === "g" ? 1_000_000_000 : match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  return base * multiplier;
}

function inferredModelContextWindow() {
  const model = String(state.selectedModel || state.modelConfig?.model || "").toLowerCase();
  if (!model) return 0;
  if (model.includes("gpt-5") || model.includes("codex")) return 400_000;
  if (model.includes("gpt-4.1")) return 1_000_000;
  if (model.includes("o3") || model.includes("o4")) return 200_000;
  return 0;
}

function renderTokenDial() {
  const metrics = tokenUsageMetrics();
  if (!metrics.totalTokens && !metrics.contextWindow) return "";
  const title = metrics.remaining == null
    ? `${formatCompactNumber(metrics.totalTokens)} tokens used`
    : `${formatCompactNumber(metrics.remaining)} left of ${formatCompactNumber(metrics.contextWindow)}`;
  return `
    <span class="token-dial" style="--token-angle:${metrics.percent * 3.6}deg" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">
      <span>${metrics.totalTokens ? metrics.percent : "ctx"}</span>
    </span>
  `;
}

function renderChanges() {
  const changes = state.changes;
  if (!changes) {
    return `
      <div class="main-scroll changes-view">
        ${renderChangesNav()}
        ${state.changesError ? `<p class="empty-state">${escapeHtml(state.changesError)}</p>` : `<p class="empty-state">Loading changes...</p>`}
      </div>
    `;
  }
  if (!changes.ok) {
    return `
      <div class="main-scroll changes-view">
        ${renderChangesNav()}
        <p class="empty-state">${escapeHtml(changes.error || "No git context for this thread.")}</p>
      </div>
    `;
  }
  const files = normalizeChangeFiles(changes.files || []);
  const summary = changes.summary || {};
  return `
    <div class="main-scroll changes-view">
      ${renderChangesNav()}
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
      ${state.changesLoading ? `<p class="changes-loading">Refreshing changes...</p>` : ""}
      ${changes.turnDiff?.diff ? renderTurnDiff(changes.turnDiff) : ""}
      ${files.length ? files.map(renderChangeFile).join("") : `<p class="empty-state">${summary.filesChanged ? "Changed file details are still loading." : "No working tree changes."}</p>`}
    </div>
  `;
}

function renderChangesNav() {
  return `
    <div class="changes-nav">
      <button class="ghost-button compact" data-back-chat type="button">← Chat</button>
      <span>Changes</span>
    </div>
  `;
}

function normalizeChangeFiles(files = []) {
  return files
    .map((file) => ({
      ...file,
      path: file.path || file.filePath || file.name || "",
      status: file.status || file.changeType || "M",
    }))
    .filter((file) => file.path);
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
  return efforts.length ? efforts : ["low", "medium", "high", "xhigh"];
}

function permissionOptions() {
  return [
    { value: "default", label: "기본 권한", approvalPolicy: null },
    { value: "auto", label: "자동 검토", approvalPolicy: "on-failure" },
    { value: "full", label: "전체 권한", approvalPolicy: "never" },
  ];
}

function currentPermissionOption() {
  return permissionOptions().find((option) => option.value === state.selectedPermission) || permissionOptions()[0];
}

function approvalPolicyOverride() {
  return currentPermissionOption().approvalPolicy || undefined;
}

function formatPermission(config) {
  const approval = typeof config.approvalPolicy === "string" ? config.approvalPolicy : "default";
  const sandbox = typeof config.sandboxMode === "string" ? config.sandboxMode : "workspace";
  return `${approval} · ${sandbox}`;
}

function formatComposerPermission(config) {
  const approval = typeof config.approvalPolicy === "string" ? config.approvalPolicy : "default";
  return approval === "default" || approval === "on-request" ? "기본 권한" : approval;
}

function formatEffortLabel(effort) {
  const labels = {
    none: "없음",
    minimal: "최소",
    low: "낮음",
    medium: "중간",
    high: "높음",
    xhigh: "최고",
  };
  return labels[effort] || effort;
}

function formatModelLabel(model) {
  const value = String(model || "default");
  return value
    .replace(/^gpt-/, "")
    .replace(/^codex-/, "")
    .replace(/-/g, " ")
    .replace(/\bmini\b/i, "Mini")
    .replace(/\bhigh\b/i, "High")
    .replace(/\bmedium\b/i, "Medium")
    .replace(/\blow\b/i, "Low")
    .toUpperCase()
    .replace("GPT ", "GPT-");
}

function formatThreadStatus(status) {
  if (!status) return "";
  if (typeof status === "string") return status;
  if (typeof status === "object") return status.type || status.status || status.phase || "";
  return String(status);
}

function formatThreadListLabel(thread) {
  const status = formatThreadStatus(thread.status);
  const normalized = status.toLowerCase();
  if (!status || normalized === "notloaded" || normalized === "not_loaded") return "대화 준비";
  if (/(running|working|active)/.test(normalized)) return "실행 중";
  if (/(queued|pending)/.test(normalized)) return "대기 중";
  if (/(failed|error)/.test(normalized)) return "확인 필요";
  if (/(completed|succeeded|done|idle|finished)/.test(normalized)) return "완료";
  return status;
}

function threadStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (/(running|working|active)/.test(normalized)) return "busy";
  if (/(queued|pending)/.test(normalized)) return "pending";
  if (/(failed|error)/.test(normalized)) return "danger";
  if (/(completed|succeeded|done|idle|finished)/.test(normalized)) return "done";
  return "neutral";
}

function renderItem(item) {
  const type = item.type || item.kind || "unknown";
  if (type === "userMessage") return renderMessage("user", item);
  if (type === "agentMessage") return renderMessage("agent", item);
  if (type === "localImage" || type === "image" || type === "image_url") {
    return `<div class="message user">${renderAttachmentPreviews(extractAttachments(item))}</div>`;
  }
  if (type === "commandExecution" || type === "fileChange" || type === "webSearch") {
    return renderToolCard(type, item);
  }
  return renderToolCard(type, item);
}

function renderMessage(role, item) {
  const parsed = parseMentionedFilesText(extractText(item));
  const text = parsed?.text ?? extractText(item);
  const attachments = [...(item.attachments || []), ...(parsed?.attachments || []), ...extractAttachments(item)];
  return `
    <div class="message ${role}">
      ${renderAttachmentPreviews(dedupeAttachments(attachments))}
      ${text.trim() ? `<div class="message-body markdown-body">${renderMarkdown(text.trim())}</div>` : ""}
    </div>
  `;
}

function renderToolCard(type, item) {
  const title = toolTitle(type);
  const status = formatThreadStatus(item.status || item.outcome || item.result?.status);
  const summary = toolSummary(type, item);
  const preview = toolPreview(type, item);
  return `
    <details class="tool-card ${threadStatusTone(status)}">
      <summary>
        <span class="tool-title">${uiIcon(toolIconName(type))}<span>${escapeHtml(title)}</span></span>
        <span class="tool-summary">${escapeHtml(summary)}</span>
        ${status ? `<strong class="tool-status">${escapeHtml(formatThreadListLabel({ status }))}</strong>` : ""}
      </summary>
      ${preview ? `<div class="tool-preview">${escapeHtml(preview)}</div>` : ""}
      <pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>
    </details>
  `;
}

function toolIconName(type) {
  if (type === "commandExecution") return "terminal";
  if (type === "fileChange") return "file";
  if (type === "webSearch") return "search";
  return "tool";
}

function toolTitle(type) {
  const labels = {
    commandExecution: "실행된 명령",
    fileChange: "파일 변경",
    webSearch: "웹 검색",
    unknown: "작업 세부 정보",
  };
  return labels[type] || type;
}

function toolSummary(type, item) {
  if (type === "commandExecution") return summarizeCommand(item.command || item.commandActions?.[0]?.command || item.argv?.join?.(" "));
  if (type === "webSearch") return item.query || item.action?.url || "검색 작업";
  if (type === "fileChange") return item.path || item.filePath || item.name || "파일 변경";
  return item.name || item.title || item.id || "작업 세부 정보";
}

function toolPreview(type, item) {
  if (type === "commandExecution") return item.command || item.commandActions?.[0]?.command || "";
  if (type === "webSearch") return item.action?.url || item.query || "";
  if (type === "fileChange") return item.diff || item.path || item.filePath || "";
  return "";
}

function summarizeCommand(command) {
  const value = String(command || "").replace(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+/, "").trim();
  if (!value) return "명령 실행";
  return value.length > 96 ? `${value.slice(0, 93)}…` : value;
}

function renderMarkdown(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const blocks = [];
  let paragraph = [];
  let codeLines = [];
  let codeLang = "";
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };
  const flushCode = () => {
    const language = codeLang ? `<span class="code-language">${escapeHtml(codeLang)}</span>` : "";
    blocks.push(`<pre class="code-block">${language}<code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
    codeLang = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    const fence = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
        codeLang = fence[1] || "";
      }
      continue;
    }
    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (/^\s*[-*_]{3,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push("<hr />");
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      flushParagraph();
      const level = Math.min(4, line.match(/^#+/)?.[0].length || 3);
      blocks.push(`<h${level}>${renderInlineMarkdown(line.replace(/^#{1,4}\s+/, ""))}</h${level}>`);
      continue;
    }
    if (isMarkdownTable(lines, index)) {
      flushParagraph();
      const tableRows = [lines[index]];
      index += 2;
      while (index < lines.length && looksLikeTableRow(lines[index])) {
        tableRows.push(lines[index]);
        index += 1;
      }
      index -= 1;
      blocks.push(renderMarkdownTable(tableRows));
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      const quoteLines = [quote[1]];
      while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1])) {
        index += 1;
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
      }
      blocks.push(`<blockquote>${quoteLines.map((item) => `<p>${renderInlineMarkdown(item)}</p>`).join("")}</blockquote>`);
      continue;
    }
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const ordered = /\d+\./.test(listMatch[2]);
      const items = [listMatch[3]];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        if (!next || /\d+\./.test(next[2]) !== ordered) break;
        index += 1;
        items.push(next[3]);
      }
      const tag = ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
      continue;
    }
    paragraph.push(line.trim());
  }
  if (inCode) flushCode();
  flushParagraph();
  return blocks.join("");
}

function isMarkdownTable(lines, index) {
  return looksLikeTableRow(lines[index]) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]);
}

function looksLikeTableRow(line) {
  const value = String(line || "").trim();
  return value.includes("|") && !value.startsWith("```");
}

function renderMarkdownTable(rows) {
  const [header, ...body] = rows.map(splitMarkdownRow);
  return `
    <div class="markdown-table-wrap">
      <table>
        <thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>
        <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function splitMarkdownRow(row) {
  return String(row || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInlineMarkdown(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label, href) => `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${label}</a>`)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function renderAttachmentPreviews(attachments = []) {
  if (!attachments.length) return "";
  return `
    <div class="message-attachments">
      ${attachments.map((attachment) => {
        const name = attachment.name || pathBasename(attachment.path || attachment.url || "Attachment");
        const image = attachment.isImage || isImagePath(name) || isImagePath(attachment.path || attachment.url || "");
        const src = attachment.previewUrl || attachment.url || localPreviewUrl(attachment);
        if (image && src) {
          return `
            <figure class="attachment-preview image-preview">
              <img src="${escapeAttr(src)}" alt="${escapeAttr(name)}" loading="lazy" />
              <figcaption>${escapeHtml(name)}</figcaption>
            </figure>
          `;
        }
        return `<span class="attachment-preview file-preview">${escapeHtml(name)}</span>`;
      }).join("")}
    </div>
  `;
}

function parseMentionedFilesText(text) {
  if (!String(text || "").startsWith("# Files mentioned by the user:")) return null;
  const marker = "## My request for Codex:";
  const index = text.indexOf(marker);
  if (index < 0) return null;
  const filesBlock = text.slice(0, index);
  const body = text.slice(index + marker.length).trim();
  const lines = filesBlock.split("\n");
  const attachments = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = lines[lineIndex].match(/^##\s+(.+?):\s*$/);
    if (!match) continue;
    const filePath = lines.slice(lineIndex + 1).find((line) => line.trim().startsWith("/"))?.trim();
    if (!filePath) continue;
    attachments.push({
      name: match[1],
      path: filePath,
      isImage: isImagePath(match[1]) || isImagePath(filePath),
    });
  }
  return { text: body, attachments };
}

function extractAttachments(value) {
  const attachments = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const type = String(node.type || node.kind || "");
    const pathValue = node.path || node.filePath || node.localPath;
    const urlValue = node.url || node.imageUrl || node.image_url;
    const mime = String(node.mime || node.mimeType || "");
    const imageHint = /image|localImage|image_url/.test(type) || mime.startsWith("image/");
    if (imageHint && (pathValue || urlValue)) {
      attachments.push({
        name: node.name || pathBasename(pathValue || urlValue),
        path: pathValue || null,
        url: urlValue || null,
        isImage: true,
      });
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return attachments;
}

function dedupeAttachments(attachments = []) {
  const seen = new Set();
  return attachments.filter((attachment) => {
    const key = attachment.previewUrl || attachment.url || attachment.path || attachment.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function localPreviewUrl(attachment) {
  const previewId = attachment.previewId || attachment.id || state.previewIdsByPath[attachment.path];
  if (!previewId) return "";
  return `/api/local-file?id=${encodeURIComponent(previewId)}&token=${encodeURIComponent(state.token || "")}`;
}

function pathBasename(value) {
  return String(value || "Attachment").split(/[\\/]/).filter(Boolean).pop() || "Attachment";
}

function isImagePath(value) {
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(String(value || ""));
}

function renderApproval(approval) {
  const summary = summarizeApproval(approval);
  return `
    <div class="approval-card">
      <strong>${escapeHtml(summary.title)}</strong>
      ${summary.detail ? `<pre class="approval-command">${escapeHtml(summary.detail)}</pre>` : ""}
      <div class="approval-actions">
        <button class="approval-choice" data-approval="${approval.requestId}" data-decision="allow" type="button">
          <span>1.</span>
          <strong>예</strong>
        </button>
        <button class="approval-choice" data-approval="${approval.requestId}" data-decision="allow" data-remember="true" type="button">
          <span>2.</span>
          <strong>네, 그리고 이번 세션에서 다시 묻지 않기</strong>
        </button>
        <button class="approval-choice muted-choice" data-approval="${approval.requestId}" data-decision="deny" type="button">
          <span>3.</span>
          <strong>아니요, Codex에게 다르게 하라고 하기</strong>
        </button>
        <button class="approval-skip" data-approval="${approval.requestId}" data-decision="cancel" type="button">건너뛰기</button>
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
  emit();
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

function shell(title, subtitle, content, options: AnyRecord = {}) {
  setTimeout(() => {
    const back = app.querySelector("[data-back]") as HTMLElement | null;
    if (back && options.back) back.addEventListener("click", options.back);
    const notifications = app.querySelector("[data-enable-notifications]") as HTMLElement | null;
    if (notifications) notifications.addEventListener("click", () => enableNotifications().catch((error) => alert(error.message)));
  });
  return `
    <section class="workspace">
      <header class="topbar">
        ${options.back ? `<button class="icon-button" data-back aria-label="Back">‹</button>` : ""}
        <div class="topbar-title">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle || "")}</span>
        </div>
      </header>
      ${content}
    </section>
  `;
}

function isWideScreen() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

async function fetchJson(url, options: AnyRecord = {}) {
  const headers: AnyRecord = { "content-type": "application/json" };
  if (options.auth !== false && state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let data: AnyRecord = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function extractText(item) {
  if (!item || typeof item !== "object") return "";
  const directText = textFromValue(item.text) || textFromValue(item.message) || textFromValue(item.content);
  if (directText) return directText;
  const arrayText = [
    item.content,
    item.input,
    item.parts,
    item.messages,
    item.output,
  ].map(textFromValue).filter(Boolean).join("");
  if (arrayText) return arrayText;
  const nestedText = textFromValue(item.data) || textFromValue(item.payload) || textFromValue(item.params);
  if (nestedText) return nestedText;
  return "";
}

function textFromValue(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join("");
  if (typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (typeof value.value === "string") return value.value;
  if (typeof value.markdown === "string") return value.markdown;
  if (typeof value.message === "string") return value.message;
  if (value.text && typeof value.text === "object") return textFromValue(value.text);
  if (value.content && typeof value.content === "object") return textFromValue(value.content);
  if (value.input && typeof value.input === "object") return textFromValue(value.input);
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

function formatCompactNumber(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(number);
}

function uiIcon(name) {
  const icons = {
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
    chat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-5 4v-4.2A3.5 3.5 0 0 1 5 10.5v-4Z"/></svg>`,
    changes: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 12h7M7 17h10M4 4v16h16V4H4Z"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="M18.5 13.5v-3l-2-.4a6.7 6.7 0 0 0-.8-1.8l1.1-1.8-2.1-2.1-1.8 1.1a6.7 6.7 0 0 0-1.8-.8l-.4-2h-3l-.4 2a6.7 6.7 0 0 0-1.8.8L4.7 4.4 2.6 6.5l1.1 1.8a6.7 6.7 0 0 0-.8 1.8l-2 .4v3l2 .4c.2.7.5 1.3.8 1.8l-1.1 1.8 2.1 2.1 1.8-1.1c.6.4 1.2.6 1.8.8l.4 2h3l.4-2c.7-.2 1.3-.5 1.8-.8l1.8 1.1 2.1-2.1-1.1-1.8c.4-.6.6-1.2.8-1.8l2-.4Z"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3ZM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.4-2.8 7.4-7 9.5-4.2-2.1-7-5.1-7-9.5V6l7-3Z"/></svg>`,
    brain: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5A3.5 3.5 0 0 0 5.5 8v.4A3.8 3.8 0 0 0 4 11.5 3.5 3.5 0 0 0 7.5 15H9v4.5M15 4.5A3.5 3.5 0 0 1 18.5 8v.4a3.8 3.8 0 0 1 1.5 3.1A3.5 3.5 0 0 1 16.5 15H15v4.5M9 9h6M9 13h6"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>`,
    chevronRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>`,
    send: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l15-7-7 15-2-6-6-2Z"/></svg>`,
    stop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.5V20h2.5L17.8 8.7l-2.5-2.5L4 17.5Z"/><path d="M14.5 7l2.5 2.5"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13"/></svg>`,
    terminal: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M7 9l3 3-3 3M12 16h5"/></svg>`,
    file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L20 20"/><path d="M8 10h5"/></svg>`,
    tool: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l4 4-9 9H5v-4l9-9Z"/><path d="M13 7l4 4"/></svg>`,
  };
  return icons[name] || icons.tool;
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

export const mobileController = {
  init,
  loadDesktopStatus,
  startDesktopLogin,
  cancelDesktopLogin,
  showPairingQr,
  completePair,
  loadProjects,
  loadThreads,
  loadThread,
  createThread,
  loadModels,
  loadSettings,
  backToWorkspace,
  loadChanges,
  loadBranches,
  loadTokenUsage,
  loadSkills,
  sendMessage,
  interruptThread,
  runThreadAction,
  checkoutBranch,
  commitChanges,
  enableNotifications,
  answerApproval,
  flushMessageQueue,
  steerQueuedMessage,
  removeQueuedMessage,
  editQueuedMessage,
  uploadAttachments,
  renderCurrentView,
};

export const mobileSelectors = {
  formatDate,
  formatClock,
  formatCompactNumber,
  formatThreadStatus,
  formatThreadListLabel,
  threadStatusTone,
  renderMarkdown,
  extractText,
  extractAttachments,
  parseMentionedFilesText,
  dedupeAttachments,
  localPreviewUrl,
  toolTitle,
  toolSummary,
  toolPreview,
  isThreadBusy,
  summarizeApproval,
  permissionOptions,
  currentPermissionOption,
  renderRateLimit,
  formatAccount,
  formatPermission,
  pathBasename,
  isImagePath,
};
