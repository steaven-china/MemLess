import type { I18n } from "../i18n/index.js";

export function renderAppHtml(i18n: I18n): string {
  const escapedMessages = JSON.stringify(i18n.messages).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${i18n.locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${i18n.t("web.title.app")}</title>
  <style>
    :root {
      --bg: #f7f7f8;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #111827;
      --accent-2: #374151;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; background: var(--bg); color: var(--ink); }
    .shell { max-width: 1400px; margin: 0 auto; height: 100%; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .layout { flex: 1; min-height: 0; display: flex; gap: 12px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 30px rgba(17, 24, 39, 0.04); animation: cardIn 220ms ease-out; }
    .header { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
    .title { font-size: 15px; font-weight: 600; letter-spacing: 0.2px; }
    .status { font-size: 12px; color: var(--muted); transition: color 160ms ease; }
    .status[data-live="1"]::before { content: "●"; color: #16a34a; margin-right: 6px; }
    .status[data-live="0"]::before { content: "●"; color: #ef4444; margin-right: 6px; animation: pulseDot 1s ease-in-out infinite; }
    .status[data-live="0"] { animation: statusPulse 1.1s ease-in-out infinite; }
    .chat-panel { display:flex; flex: 1; min-height:0; flex-direction:column; }
    .messages { flex: 1; min-height: 0; padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .bubble { max-width: 85%; white-space: pre-wrap; line-height: 1.55; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); animation: bubbleIn 220ms cubic-bezier(.2,.8,.2,1); }
    .bubble.user { margin-left: auto; background: #111827; color: #fff; border-color: #111827; transform-origin: right bottom; }
    .bubble.assistant { margin-right: auto; background: #fff; color: #111827; transform-origin: left bottom; }
    .bubble.assistant.streaming { color: #4b5563; position: relative; overflow: hidden; }
    .bubble.assistant.streaming::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.65) 45%, transparent 65%); animation: shimmer 1.3s linear infinite; }
    .composer { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid var(--line); }
    textarea { width: 100%; resize: vertical; min-height: 78px; max-height: 220px; border: 1px solid var(--line); outline: none; border-radius: 10px; padding: 10px; font: inherit; background: #fff; transition: border-color 140ms ease, box-shadow 140ms ease; }
    textarea:focus { border-color: #9ca3af; box-shadow: 0 0 0 3px rgba(17,24,39,0.06); }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
    button { border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 10px; padding: 8px 12px; cursor: pointer; font: inherit; transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease; }
    button:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(17, 24, 39, 0.08); }
    button:active { transform: translateY(0); }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.primary:disabled { background: var(--accent-2); border-color: var(--accent-2); cursor: not-allowed; box-shadow: none; transform: none; }
    .hint { padding: 0 14px 12px; color: var(--muted); font-size: 12px; }
    .raw-context { margin: 0 14px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; transition: border-color 140ms ease; }
    .raw-context > summary { cursor: pointer; padding: 8px 10px; font-size: 12px; color: var(--muted); background: #f9fafb; }
    .raw-context[open] > summary { border-bottom: 1px solid var(--line); }
    .raw-context pre { margin: 0; padding: 10px; max-height: 220px; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; background: #fcfcfd; }
    .debug { width: 520px; max-width: 48%; display: flex; flex-direction: column; min-height: 0; }
    .debug-head { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .debug-scroll { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .storage-line { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #f3f4f6; word-break: break-all; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; }
    .metric-label { font-size: 11px; color: var(--muted); }
    .metric-value { font-size: 18px; font-weight: 600; margin-top: 2px; }
    .retention { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; }
    .retention-title { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
    .retention-bar { height: 10px; width: 100%; display: flex; overflow: hidden; border-radius: 999px; background: #f3f4f6; }
    .retention-bar > span { display: block; height: 100%; }
    .bar-raw { background: #16a34a; }
    .bar-compressed { background: #f59e0b; }
    .bar-conflict { background: #ef4444; }
    .retention-text { margin-top: 6px; font-size: 11px; color: var(--muted); }
    .section { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; }
    .section-head { padding: 8px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; }
    .table-wrap { max-height: 190px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { background: #f3f4f6; font-size: 11px; color: var(--muted); position: sticky; top: 0; z-index: 1; }
    tr[data-clickable="1"] { cursor: pointer; }
    tr[data-clickable="1"]:hover td { background: #fafafa; }
    .context-yes { color: #16a34a; font-weight: 600; }
    .empty { padding: 10px; font-size: 12px; color: var(--muted); }
    .modal { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 30; }
    .modal[hidden] { display: none !important; }
    .modal-card { width: min(960px, 95vw); max-height: 90vh; background: #fff; border-radius: 12px; border: 1px solid var(--line); overflow: hidden; display: flex; flex-direction: column; }
    .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .modal-title { font-size: 14px; font-weight: 600; }
    .modal-content { margin: 0; padding: 12px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; flex: 1; background: #fcfcfd; }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pulseDot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    @keyframes statusPulse {
      0%, 100% { color: var(--muted); }
      50% { color: #111827; }
    }
    @keyframes shimmer {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }
    @media (max-width: 960px) {
      .layout { flex-direction: column; }
      .debug { width: 100%; max-width: none; max-height: 50vh; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card header">
      <div class="title">${i18n.t("web.title.minimal")}</div>
      <div class="status" id="status" data-live="1">${i18n.t("web.status.ready")}</div>
    </section>
    <div class="layout">
      <section class="card chat-panel">
        <div class="messages" id="messages"></div>
        <form class="composer" id="composer">
          <textarea id="input" placeholder="${i18n.t("web.input.placeholder")}"></textarea>
          <div class="actions">
            <button type="button" id="debugBtn">${i18n.t("web.button.debug")}</button>
            <button type="button" id="sealBtn">${i18n.t("web.button.seal")}</button>
            <button type="button" id="stopBtn">${i18n.t("web.button.stop")}</button>
            <button type="submit" class="primary" id="sendBtn">${i18n.t("web.button.send")}</button>
          </div>
        </form>
        <div class="hint">${i18n.t("web.hint.main")}</div>
        <div class="hint">${i18n.t("web.hint.agent_files")}</div>
        <div class="hint" id="activeFileStatus">${i18n.t("web.hint.active_file_empty")}</div>
        <details class="raw-context">
          <summary>${i18n.t("web.raw_context.summary")}</summary>
          <pre id="rawContextView">${i18n.t("web.raw_context.empty")}</pre>
        </details>
      </section>
      <section class="card debug" id="debugPanel" hidden>
        <div class="debug-head">
          <span>${i18n.t("web.debug.title")}</span>
          <button type="button" id="refreshDebugBtn">${i18n.t("web.debug.refresh")}</button>
        </div>
        <div class="debug-scroll">
          <div class="storage-line" id="storageLine">${i18n.t("web.debug.storage_unloaded")}</div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.blocks")}</div><div class="metric-value" id="metricBlocks">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.raw_buckets")}</div><div class="metric-value" id="metricRawBuckets">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.raw_events")}</div><div class="metric-value" id="metricRawEvents">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.relations")}</div><div class="metric-value" id="metricRelations">0</div></div>
          </div>
          <div class="retention">
            <div class="retention-title">${i18n.t("web.debug.retention_distribution")}</div>
            <div class="retention-bar">
              <span class="bar-raw" id="barRaw" style="width:0%"></span>
              <span class="bar-compressed" id="barCompressed" style="width:0%"></span>
              <span class="bar-conflict" id="barConflict" style="width:0%"></span>
            </div>
            <div class="retention-text" id="retentionText">${i18n.t("web.retention.text", { raw: 0, compressed: 0, conflict: 0 })}</div>
          </div>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.context_blocks")}</span><span id="contextMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.block")}</th><th>${i18n.t("web.table.score")}</th><th>${i18n.t("web.table.source")}</th><th>${i18n.t("web.table.time")}</th><th>${i18n.t("web.table.raw")}</th></tr></thead>
                <tbody id="contextRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.database_blocks")}</span><span id="blocksMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.block")}</th><th>${i18n.t("web.table.time")}</th><th>${i18n.t("web.table.tokens")}</th><th>${i18n.t("web.table.retention")}</th><th>${i18n.t("web.table.raw")}</th><th>${i18n.t("web.table.context_short")}</th></tr></thead>
                <tbody id="blockRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.database_relations")}</span><span id="relationsMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.type")}</th><th>${i18n.t("web.table.src")}</th><th>${i18n.t("web.table.dst")}</th><th>${i18n.t("web.table.time")}</th></tr></thead>
                <tbody id="relationRows"></tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </div>
  </main>
  <div class="modal" id="detailModal" hidden>
    <div class="modal-card">
      <div class="modal-head">
        <span class="modal-title" id="modalTitle">${i18n.t("web.modal.detail")}</span>
        <button type="button" id="closeModalBtn">${i18n.t("web.modal.close")}</button>
      </div>
      <pre class="modal-content" id="modalContent"></pre>
    </div>
  </div>
  <script>
    const MESSAGES = ${escapedMessages};
    function t(key, params = {}) {
      const template = Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : key;
      return String(template).replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, token) => {
        const value = params[token];
        return value == null ? "" : String(value);
      });
    }

    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("input");
    const composerEl = document.getElementById("composer");
    const debugBtn = document.getElementById("debugBtn");
    const debugPanel = document.getElementById("debugPanel");
    const refreshDebugBtn = document.getElementById("refreshDebugBtn");
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    const sealBtn = document.getElementById("sealBtn");
    const statusEl = document.getElementById("status");
    const storageLine = document.getElementById("storageLine");
    const metricBlocks = document.getElementById("metricBlocks");
    const metricRawBuckets = document.getElementById("metricRawBuckets");
    const metricRawEvents = document.getElementById("metricRawEvents");
    const metricRelations = document.getElementById("metricRelations");
    const barRaw = document.getElementById("barRaw");
    const barCompressed = document.getElementById("barCompressed");
    const barConflict = document.getElementById("barConflict");
    const retentionText = document.getElementById("retentionText");
    const contextRows = document.getElementById("contextRows");
    const blockRows = document.getElementById("blockRows");
    const relationRows = document.getElementById("relationRows");
    const contextMeta = document.getElementById("contextMeta");
    const blocksMeta = document.getElementById("blocksMeta");
    const relationsMeta = document.getElementById("relationsMeta");
    const rawContextView = document.getElementById("rawContextView");
    const activeFileStatus = document.getElementById("activeFileStatus");
    const detailModal = document.getElementById("detailModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalContent = document.getElementById("modalContent");
    const closeModalBtn = document.getElementById("closeModalBtn");
    let debugVisible = false;
    let latestDebug = null;
    let debugApiEnabled = false;
    let debugAdminTokenRequired = false;
    let debugAdminToken = loadPersistedAdminToken();
    let debugCapabilitiesLoaded = false;
    const activeSessionId = loadPersistedSessionId();
    let inflightRequestId = "";
    let activeAbortController = null;
    let proactiveEventSource = null;
    let pendingInterruptedContext = null;
    const INTERRUPT_RETAIN_SENTENCE_LIMIT = 3;
    const INTERRUPT_RETAIN_FALLBACK_CHARS = 180;
    const INTERRUPT_RETAIN_MAX_CHARS = 400;

    renderDebugButtonState();
    stopBtn.disabled = true;
    addBubble("assistant", t("web.greeting"));
    void initializeCapabilities();
    initProactiveStream();

    composerEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      const commandHandled = await handleLocalCommand(text);
      if (commandHandled) return;
      await sendMessage(text);
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        composerEl.requestSubmit();
      }
    });

    sealBtn.addEventListener("click", async () => {
      setBusy(true, t("web.status.sealing"));
      try {
        const response = await fetch("/api/seal?sessionId=" + encodeURIComponent(activeSessionId), { method: "POST" });
        if (!response.ok) throw new Error(t("web.error.seal_failed"));
        addBubble("assistant", t("web.message.sealed"));
        if (debugVisible) {
          await refreshDebug();
        }
      } catch (error) {
        addBubble("assistant", t("web.error.seal_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    });

    stopBtn.addEventListener("click", () => {
      if (!activeAbortController) return;
      activeAbortController.abort();
    });

    debugBtn.addEventListener("click", async () => {
      if (!debugApiEnabled) {
        storageLine.textContent = t("web.error.debug_api_disabled");
        return;
      }
      if (debugAdminTokenRequired && !debugAdminToken) {
        const entered = promptAdminToken();
        if (!entered) {
          storageLine.textContent = t("web.error.debug_token_required");
          return;
        }
      }
      debugVisible = !debugVisible;
      debugPanel.hidden = !debugVisible;
      renderDebugButtonState();
      if (debugVisible) {
        await refreshDebug();
      }
    });

    refreshDebugBtn.addEventListener("click", async () => {
      await refreshDebug();
    });

    contextRows.addEventListener("click", onContextRowClick);
    blockRows.addEventListener("click", onBlockRowClick);
    relationRows.addEventListener("click", onRelationRowClick);

    closeModalBtn.addEventListener("click", closeModal);
    detailModal.addEventListener("click", (event) => {
      if (event.target === detailModal) {
        closeModal();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !detailModal.hidden) {
        closeModal();
      }
    });
    window.addEventListener("beforeunload", () => {
      if (!proactiveEventSource) return;
      proactiveEventSource.close();
      proactiveEventSource = null;
    });

    async function handleLocalCommand(text) {
      if (text === "/trace-clear") {
        addBubble("user", text);
        await handleTraceClearCommand();
        return true;
      }
      if (text === "/trace" || text.startsWith("/trace ")) {
        addBubble("user", text);
        await handleTraceCommand(text);
        return true;
      }
      return false;
    }

    async function handleTraceCommand(commandText, allowAuthRetry = true) {
      const limit = parseTraceLimit(commandText);
      setBusy(true, t("web.status.trace"));
      try {
        const response = await fetch("/api/debug/traces?limit=" + String(limit), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", t("web.error.trace_api_disabled"));
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await handleTraceCommand(commandText, false);
              return;
            }
          }
          addBubble("assistant", t("web.error.trace_auth_failed"));
          return;
        }
        if (!response.ok) throw new Error(t("web.error.trace_fetch_failed"));
        const payload = await response.json();
        addBubble("assistant", JSON.stringify(payload, null, 2));
      } catch {
        addBubble("assistant", t("web.error.trace_fetch_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    }

    async function handleTraceClearCommand(allowAuthRetry = true) {
      setBusy(true, t("web.status.trace"));
      try {
        const response = await fetch("/api/debug/traces/clear", {
          method: "POST",
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", t("web.error.trace_api_disabled"));
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await handleTraceClearCommand(false);
              return;
            }
          }
          addBubble("assistant", t("web.error.trace_auth_failed"));
          return;
        }
        if (!response.ok) throw new Error(t("web.error.trace_clear_failed"));
        addBubble("assistant", t("web.message.trace_cleared"));
        if (debugVisible) {
          await refreshDebug();
        }
      } catch {
        addBubble("assistant", t("web.error.trace_clear_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    }

    function parseTraceLimit(commandText) {
      const argument = commandText.slice("/trace".length).trim();
      const parsed = Number.parseInt(argument, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 200;
      }
      return Math.min(parsed, 5000);
    }

    function initProactiveStream() {
      if (typeof EventSource !== "function") {
        return;
      }
      if (proactiveEventSource) {
        proactiveEventSource.close();
      }

      const streamUrl = "/api/proactive/stream?sessionId=" + encodeURIComponent(activeSessionId);
      const source = new EventSource(streamUrl);
      proactiveEventSource = source;

      source.addEventListener("proactive", (event) => {
        const payload = parseProactiveEventPayload(event.data);
        if (!payload || payload.sessionId !== activeSessionId) {
          return;
        }
        const proactiveReply =
          typeof payload.proactiveReply === "string" ? payload.proactiveReply.trim() : "";
        if (!proactiveReply) {
          return;
        }
        addBubble("assistant", proactiveReply);
        void updateDebug();
      });
    }

    async function sendMessage(text) {
      const sessionPending =
        pendingInterruptedContext && pendingInterruptedContext.sessionId === activeSessionId
          ? pendingInterruptedContext
          : null;
      const requestText = sessionPending
        ? composeInterruptResumePrompt(sessionPending.originalQuestion, sessionPending.partialText, text)
        : text;
      if (sessionPending) {
        pendingInterruptedContext = null;
      }

      addBubble("user", text);
      const assistantBubble = addBubble("assistant", "");
      assistantBubble.classList.add("streaming");
      setBusy(true, t("web.status.thinking"));
      const requestId = createRequestId();
      inflightRequestId = requestId;
      const abortController = new AbortController();
      activeAbortController = abortController;
      let textSoFar = "";

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: requestText, sessionId: activeSessionId, requestId }),
          signal: abortController.signal
        });

        if (!response.ok || !response.body) {
          const fallback = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: requestText, sessionId: activeSessionId, requestId }),
            signal: abortController.signal
          });
          if (!fallback.ok) {
            throw new Error(t("web.error.chat_fallback_failed"));
          }
          const data = await fallback.json();
          if (!isCurrentMessageFrame(data, requestId)) {
            return;
          }
          const replyText = typeof data.reply === "string" ? data.reply : t("web.error.request_failed");
          const proactiveText = typeof data.proactiveReply === "string" ? data.proactiveReply : "";
          assistantBubble.textContent = proactiveText
            ? replyText + "\\n\\n" + proactiveText
            : replyText;
          assistantBubble.classList.remove("streaming");
          renderActiveFileStatus(data.latestReadFilePath);
          renderRawContext(data.rawContext ?? {
            formatted: data.context ?? "",
            blocks: Array.isArray(data.blocks) ? data.blocks : [],
            prediction: data.prediction ?? null
          });
          await updateDebug();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\\n\\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseFrame(frame);
            if (!isCurrentMessageFrame(parsed.data, requestId)) {
              boundary = buffer.indexOf("\\n\\n");
              continue;
            }
            if (parsed.event === "token") {
              const token = parsed.data?.token ?? "";
              textSoFar += token;
              assistantBubble.textContent = textSoFar;
            } else if (parsed.event === "done") {
              if (!textSoFar && typeof parsed.data?.reply === "string") {
                textSoFar = parsed.data.reply;
              }
              const proactive = typeof parsed.data?.proactiveReply === "string" ? parsed.data.proactiveReply : "";
              assistantBubble.textContent = proactive ? textSoFar + "\\n\\n" + proactive : textSoFar;
              assistantBubble.classList.remove("streaming");
              renderActiveFileStatus(parsed.data?.latestReadFilePath);
              renderRawContext(parsed.data?.rawContext ?? {
                formatted: parsed.data?.context ?? "",
                blocks: Array.isArray(parsed.data?.blocks) ? parsed.data.blocks : [],
                prediction: parsed.data?.prediction ?? null
              });
              await updateDebug();
            } else if (parsed.event === "error") {
              assistantBubble.textContent = "[" + t("web.error.stream_unknown") + "] " + (parsed.data?.error ?? t("web.error.stream_unknown"));
              assistantBubble.classList.remove("streaming");
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
            boundary = buffer.indexOf("\\n\\n");
          }
        }
      } catch (error) {
        const interrupted = abortController.signal.aborted;
        if (interrupted) {
          const interruptedText = formatInterruptedAssistantText(textSoFar);
          assistantBubble.textContent = interruptedText;
          assistantBubble.classList.remove("streaming");
          pendingInterruptedContext = {
            sessionId: activeSessionId,
            originalQuestion: text,
            partialText: textSoFar,
            at: Date.now()
          };
        } else {
          assistantBubble.textContent = t("web.error.stream_failed");
          assistantBubble.classList.remove("streaming");
        }
      } finally {
        if (inflightRequestId === requestId) {
          inflightRequestId = "";
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        setBusy(false, t("web.status.ready"));
      }
    }

    function parseProactiveEventPayload(rawPayload) {
      if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
        return null;
      }
      try {
        const parsed = JSON.parse(rawPayload);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }

    function addBubble(role, text) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      bubble.textContent = text;
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return bubble;
    }

    function setBusy(isBusy, label) {
      sendBtn.disabled = isBusy;
      stopBtn.disabled = !isBusy;
      statusEl.textContent = label;
      statusEl.dataset.live = isBusy ? "0" : "1";
    }

    function parseSseFrame(frame) {
      let event = "message";
      const dataLines = [];
      for (const line of frame.split("\\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      const raw = dataLines.join("\\n");
      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = { raw };
        }
      }
      return { event, data };
    }

    function composeInterruptResumePrompt(previousQuestion, partialAssistantText, newQuestion) {
      const retainedPrefix = retainLeadingSentences(partialAssistantText);
      return [
        "你正在继续一次被打断的对话。",
        "[打断前用户问题]",
        (previousQuestion || "").trim() || "(空)",
        "",
        "[已输出但被打断的前文（节选）]",
        retainedPrefix || "(无)",
        "",
        "[用户打断后新输入]",
        (newQuestion || "").trim() || "(空)",
        "",
        "请遵循：优先延续原回答；若新输入要求转向，先衔接一句再转答；避免重复已输出内容。"
      ].join("\\n");
    }

    function retainLeadingSentences(content) {
      const normalized = String(content ?? "").replace(/\\r\\n/g, "\\n").trim();
      if (!normalized) return "";
      const compact = normalized.replace(/\\n{2,}/g, "\\n");
      const sentenceMatches = compact.match(/[^。！？!?\\n]+(?:[。！？!?]|\\n|$)/g) ?? [];
      const sentences = sentenceMatches
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0)
        .slice(0, INTERRUPT_RETAIN_SENTENCE_LIMIT);
      const fromSentences = sentences.join(" ").trim();
      const fallback = compact.slice(0, INTERRUPT_RETAIN_FALLBACK_CHARS).trim();
      const hasDelimiter = /[。！？!?\\n]/.test(compact);
      const selected = !hasDelimiter && fromSentences.length > INTERRUPT_RETAIN_FALLBACK_CHARS
        ? fallback
        : fromSentences || fallback;
      if (!selected) return "";
      return selected.slice(0, INTERRUPT_RETAIN_MAX_CHARS).trim();
    }

    function formatInterruptedAssistantText(content) {
      const trimmed = String(content ?? "").trim();
      if (!trimmed) {
        return t("web.placeholder.interrupted");
      }
      return trimmed + "\\n\\n" + t("web.placeholder.interrupted");
    }

    function isCurrentMessageFrame(data, requestId) {
      if (!data || typeof data !== "object") return false;
      if (inflightRequestId !== requestId) return false;
      if (typeof data.requestId !== "string") return false;
      if (data.requestId !== requestId) return false;
      if (typeof data.sessionId !== "string") return false;
      return data.sessionId === activeSessionId;
    }

    async function updateDebug() {
      if (!debugVisible) return;
      await refreshDebug();
    }

    async function refreshDebug(allowAuthRetry = true) {
      if (!debugApiEnabled) {
        storageLine.textContent = t("web.error.debug_api_disabled_short");
        return;
      }
      try {
        const response = await fetch("/api/debug/database?sessionId=" + encodeURIComponent(activeSessionId), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await refreshDebug(false);
              return;
            }
          }
          storageLine.textContent = t("web.error.debug_auth_failed");
          return;
        }
        if (!response.ok) throw new Error(t("web.error.debug_fetch_failed"));
        const snapshot = await response.json();
        latestDebug = snapshot;
        renderDebug(snapshot);
      } catch {
        storageLine.textContent = t("web.error.debug_fetch_failed");
      }
    }

    function renderDebug(snapshot) {
      const storage = snapshot.storage ?? {};
      const counts = snapshot.counts ?? {};
      const retention = snapshot.retention ?? {};
      const context = snapshot.lastContext ?? null;

      storageLine.textContent = formatStorage(storage);
      metricBlocks.textContent = String(counts.blocks ?? 0);
      metricRawBuckets.textContent = String(counts.rawBuckets ?? 0);
      metricRawEvents.textContent = String(counts.rawEvents ?? 0);
      metricRelations.textContent = String(counts.relations ?? 0);

      const totalBlocks = Math.max(1, Number(counts.blocks ?? 0));
      const rawCount = Number(retention.raw ?? 0);
      const compressedCount = Number(retention.compressed ?? 0);
      const conflictCount = Number(retention.conflict ?? 0);
      barRaw.style.width = ((rawCount / totalBlocks) * 100).toFixed(2) + "%";
      barCompressed.style.width = ((compressedCount / totalBlocks) * 100).toFixed(2) + "%";
      barConflict.style.width = ((conflictCount / totalBlocks) * 100).toFixed(2) + "%";
      retentionText.textContent =
        t("web.retention.text", { raw: rawCount, compressed: compressedCount, conflict: conflictCount });

      const contextBlocks = Array.isArray(context?.blocks) ? context.blocks : [];
      const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
      const relations = Array.isArray(snapshot.relations) ? snapshot.relations : [];

      contextMeta.textContent = context
        ? t("web.context.meta", { query: context.query ?? t("web.common.dash"), count: contextBlocks.length })
        : t("web.context.meta_empty");
      blocksMeta.textContent = String(blocks.length);
      relationsMeta.textContent = String(relations.length);

      renderContextRows(contextBlocks);
      renderBlockRows(blocks);
      renderRelationRows(relations);
    }

    function renderContextRows(items) {
      contextRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        contextRows.appendChild(buildEmptyRow(6, t("web.error.no_context_blocks")));
        return;
      }
      for (const item of items) {
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.id = String(item.id ?? "");
        row.appendChild(buildCell(String(item.order ?? "-")));
        row.appendChild(buildCell(shortId(item.id)));
        row.appendChild(buildCell(fmtNum(item.score, 3)));
        row.appendChild(buildCell(String(item.source ?? "-")));
        row.appendChild(buildCell(fmtTimeRange(item.startTime, item.endTime)));
        row.appendChild(buildCell(String(item.rawEventCount ?? 0)));
        contextRows.appendChild(row);
      }
    }

    function renderBlockRows(items) {
      blockRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        blockRows.appendChild(buildEmptyRow(7, t("web.error.no_database_blocks")));
        return;
      }
      for (const item of items) {
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.id = String(item.id ?? "");
        row.appendChild(buildCell(String(item.order ?? "-")));
        row.appendChild(buildCell(shortId(item.id)));
        row.appendChild(buildCell(fmtTimeRange(item.startTime, item.endTime)));
        row.appendChild(buildCell(String(item.tokenCount ?? 0)));
        row.appendChild(buildCell(String(item.retentionMode ?? "-")));
        row.appendChild(buildCell(String(item.persistedRawEvents ?? 0)));
        const inCtxCell = buildCell(item.inContext ? t("web.table.in_context_yes") : t("web.common.dash"));
        if (item.inContext) inCtxCell.className = "context-yes";
        row.appendChild(inCtxCell);
        blockRows.appendChild(row);
      }
    }

    function renderRelationRows(items) {
      relationRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        relationRows.appendChild(buildEmptyRow(5, t("web.error.no_relations")));
        return;
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.index = String(index);
        row.appendChild(buildCell(String(item.order ?? index + 1)));
        row.appendChild(buildCell(String(item.type ?? "-")));
        row.appendChild(buildCell(shortId(item.src)));
        row.appendChild(buildCell(shortId(item.dst)));
        row.appendChild(buildCell(fmtTime(item.timestamp)));
        relationRows.appendChild(row);
      }
    }

    async function onBlockRowClick(event) {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      const blockId = row.dataset.id;
      if (!blockId) return;
      await loadBlockDetail(blockId, true);
    }

    async function loadBlockDetail(blockId, allowAuthRetry) {
      try {
        const response = await fetch("/api/debug/block?id=" + encodeURIComponent(blockId) + "&sessionId=" + encodeURIComponent(activeSessionId), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.debug_api_disabled_short") });
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await loadBlockDetail(blockId, false);
              return;
            }
          } else {
            openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.unauthorized") });
            return;
          }
          openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.unauthorized") });
          return;
        }
        if (!response.ok) throw new Error(t("web.error.load_failed"));
        const detail = await response.json();
        openModal(t("web.modal.block_detail_with_id", { id: shortId(blockId) }), detail);
      } catch {
        openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.load_failed") });
      }
    }

    function onContextRowClick(event) {
      const row = event.target.closest("tr[data-id]");
      if (!row || !latestDebug || !latestDebug.lastContext) return;
      const blockId = row.dataset.id;
      const item = (latestDebug.lastContext.blocks ?? []).find((candidate) => candidate.id === blockId);
      if (!item) return;
      openModal(t("web.modal.context_block_with_id", { id: shortId(blockId) }), item);
    }

    function onRelationRowClick(event) {
      const row = event.target.closest("tr[data-index]");
      if (!row || !latestDebug) return;
      const index = Number.parseInt(row.dataset.index ?? "-1", 10);
      if (!Number.isFinite(index) || index < 0) return;
      const item = (latestDebug.relations ?? [])[index];
      if (!item) return;
      openModal(t("web.modal.relation_detail"), item);
    }

    function openModal(title, payload) {
      modalTitle.textContent = title;
      modalContent.textContent = JSON.stringify(payload, null, 2);
      detailModal.hidden = false;
    }

    function closeModal() {
      detailModal.hidden = true;
    }

    function buildCell(text) {
      const cell = document.createElement("td");
      cell.textContent = text;
      return cell;
    }

    function buildEmptyRow(colspan, text) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = colspan;
      cell.className = "empty";
      cell.textContent = text;
      row.appendChild(cell);
      return row;
    }

    function shortId(value) {
      const text = String(value ?? "");
      if (text.length <= 12) return text;
      return t("web.id.ellipsis", { head: text.slice(0, 8), tail: text.slice(-4) });
    }

    function fmtNum(value, digits) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) return t("web.number.zero");
      return number.toFixed(digits);
    }

    function fmtTime(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number <= 0) return t("web.common.dash");
      try {
        return new Date(number).toLocaleString();
      } catch {
        return String(number);
      }
    }

    function fmtTimeRange(start, end) {
      const left = fmtTime(start);
      const right = fmtTime(end);
      if (left === t("web.common.dash") && right === t("web.common.dash")) return t("web.common.dash");
      if (left === right) return left;
      return t("web.list.arrow", { left, right });
    }

    function formatStorage(storage) {
      const parts = [];
      parts.push(t("web.storage.backend", { value: String(storage.storageBackend ?? t("web.common.dash")) }));
      parts.push(t("web.storage.raw", { value: String(storage.rawStoreBackend ?? t("web.common.dash")) }));
      parts.push(
        t("web.storage.relation", { value: String(storage.relationStoreBackend ?? t("web.common.dash")) })
      );
      if (storage.sqliteFilePath) parts.push(t("web.storage.sqlite", { value: storage.sqliteFilePath }));
      if (storage.sqliteFileSizeBytes != null) {
        parts.push(t("web.storage.sqlite_size", { value: formatBytes(storage.sqliteFileSizeBytes) }));
      }
      if (storage.lanceFilePath) parts.push(t("web.storage.lance", { value: storage.lanceFilePath }));
      if (storage.rawStoreFilePath) parts.push(t("web.storage.raw_file", { value: storage.rawStoreFilePath }));
      if (storage.relationStoreFilePath) {
        parts.push(t("web.storage.relation_file", { value: storage.relationStoreFilePath }));
      }
      return parts.join(" | ");
    }

    function formatBytes(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number < 0) return t("web.common.dash");
      if (number < 1024) return t("web.byte.b", { value: number });
      if (number < 1024 * 1024) return t("web.byte.kb", { value: (number / 1024).toFixed(1) });
      return t("web.byte.mb", { value: (number / (1024 * 1024)).toFixed(2) });
    }

    function renderRawContext(rawContext) {
      if (!rawContextView) return;
      rawContextView.textContent = JSON.stringify(rawContext ?? { empty: true }, null, 2);
    }

    function renderActiveFileStatus(filePath) {
      if (!activeFileStatus) return;
      if (typeof filePath === "string" && filePath.trim().length > 0) {
        activeFileStatus.textContent = t("web.hint.active_file", { path: filePath });
        activeFileStatus.title = filePath;
        return;
      }
      activeFileStatus.textContent = t("web.hint.active_file_empty");
      activeFileStatus.removeAttribute("title");
    }

    async function initializeCapabilities() {
      try {
        const response = await fetch("/api/capabilities");
        if (!response.ok) throw new Error(t("web.error.load_failed"));
        const payload = await response.json();
        debugApiEnabled = Boolean(payload.debugApiEnabled);
        debugAdminTokenRequired = Boolean(payload.adminTokenRequired);
      } catch {
        debugApiEnabled = false;
        debugAdminTokenRequired = false;
      } finally {
        debugCapabilitiesLoaded = true;
        renderDebugButtonState();
      }
    }

    function renderDebugButtonState() {
      if (!debugCapabilitiesLoaded) {
        debugBtn.textContent = t("web.button.debug_loading");
        debugBtn.disabled = true;
        return;
      }
      if (!debugApiEnabled) {
        debugBtn.textContent = t("web.button.debug_off");
        debugBtn.disabled = true;
        return;
      }
      debugBtn.disabled = false;
      debugBtn.textContent = debugVisible ? t("web.button.debug_on") : t("web.button.debug");
    }

    function disableDebugApi() {
      debugApiEnabled = false;
      debugVisible = false;
      debugPanel.hidden = true;
      renderDebugButtonState();
      storageLine.textContent = t("web.error.debug_api_disabled_404");
    }

    function buildAdminHeaders() {
      if (!debugAdminToken) return {};
      return {
        "x-mlex-admin-token": debugAdminToken
      };
    }

    function loadPersistedAdminToken() {
      try {
        const token = window.localStorage.getItem("mlex.debugAdminToken") ?? "";
        const normalized = token.trim();
        return normalized.length > 0 ? normalized : "";
      } catch {
        return "";
      }
    }

    function promptAdminToken() {
      const current = debugAdminToken || "";
      const entered = window.prompt(t("web.prompt.debug_token"), current);
      if (typeof entered !== "string") return "";
      const normalized = entered.trim();
      if (normalized.length === 0) return "";
      debugAdminToken = normalized;
      try {
        window.localStorage.setItem("mlex.debugAdminToken", normalized);
      } catch {}
      return normalized;
    }

    function loadPersistedSessionId() {
      try {
        const existing = window.localStorage.getItem("mlex.web.sessionId") ?? "";
        const normalized = existing.trim();
        if (normalized.length > 0) {
          return normalized;
        }
        const created = createRequestId();
        window.localStorage.setItem("mlex.web.sessionId", created);
        return created;
      } catch {
        return createRequestId();
      }
    }

    function createRequestId() {
      const globalCrypto = window.crypto;
      if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
        return globalCrypto.randomUUID();
      }
      return "req-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  </script>
</body>
</html>`;
}
