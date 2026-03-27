export function renderAppHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MLEX Web</title>
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
      <div class="title">MLEX Minimal Web</div>
      <div class="status" id="status" data-live="1">ready</div>
    </section>
    <div class="layout">
      <section class="card chat-panel">
        <div class="messages" id="messages"></div>
        <form class="composer" id="composer">
          <textarea id="input" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea>
          <div class="actions">
            <button type="button" id="debugBtn">Debug</button>
            <button type="button" id="sealBtn">Seal</button>
            <button type="submit" class="primary" id="sendBtn">Send</button>
          </div>
        </form>
        <div class="hint">极简前端：默认流式输出，支持多行粘贴，支持 /trace [n] 与 /trace-clear。</div>
        <details class="raw-context">
          <summary>原始上下文（最近一次）</summary>
          <pre id="rawContextView">暂无上下文</pre>
        </details>
      </section>
      <section class="card debug" id="debugPanel" hidden>
        <div class="debug-head">
          <span>数据库调试可视化（右侧）</span>
          <button type="button" id="refreshDebugBtn">刷新</button>
        </div>
        <div class="debug-scroll">
          <div class="storage-line" id="storageLine">未加载存储信息</div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">Blocks</div><div class="metric-value" id="metricBlocks">0</div></div>
            <div class="metric"><div class="metric-label">Raw Buckets</div><div class="metric-value" id="metricRawBuckets">0</div></div>
            <div class="metric"><div class="metric-label">Raw Events</div><div class="metric-value" id="metricRawEvents">0</div></div>
            <div class="metric"><div class="metric-label">Relations</div><div class="metric-value" id="metricRelations">0</div></div>
          </div>
          <div class="retention">
            <div class="retention-title">Retention 分布</div>
            <div class="retention-bar">
              <span class="bar-raw" id="barRaw" style="width:0%"></span>
              <span class="bar-compressed" id="barCompressed" style="width:0%"></span>
              <span class="bar-conflict" id="barConflict" style="width:0%"></span>
            </div>
            <div class="retention-text" id="retentionText">raw 0 / compressed 0 / conflict 0</div>
          </div>
          <section class="section">
            <div class="section-head"><span>当前上下文块</span><span id="contextMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Block</th><th>Score</th><th>Source</th><th>Time</th><th>Raw</th></tr></thead>
                <tbody id="contextRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>数据库 Blocks</span><span id="blocksMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Block</th><th>Time</th><th>Tokens</th><th>Retention</th><th>Raw</th><th>Ctx</th></tr></thead>
                <tbody id="blockRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>数据库 Relations</span><span id="relationsMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Type</th><th>Src</th><th>Dst</th><th>Time</th></tr></thead>
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
        <span class="modal-title" id="modalTitle">详情</span>
        <button type="button" id="closeModalBtn">关闭</button>
      </div>
      <pre class="modal-content" id="modalContent"></pre>
    </div>
  </div>
  <script>
    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("input");
    const composerEl = document.getElementById("composer");
    const debugBtn = document.getElementById("debugBtn");
    const debugPanel = document.getElementById("debugPanel");
    const refreshDebugBtn = document.getElementById("refreshDebugBtn");
    const sendBtn = document.getElementById("sendBtn");
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

    renderDebugButtonState();
    addBubble("assistant", "你好，我是 MLEX。你可以直接粘贴多行内容开始对话。");
    void initializeCapabilities();

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
      setBusy(true, "sealing");
      try {
        const response = await fetch("/api/seal", { method: "POST" });
        if (!response.ok) throw new Error("seal failed");
        addBubble("assistant", "已封存当前 active block。");
        if (debugVisible) {
          await refreshDebug();
        }
      } catch (error) {
        addBubble("assistant", "Seal 失败，请稍后重试。");
      } finally {
        setBusy(false, "ready");
      }
    });

    debugBtn.addEventListener("click", async () => {
      if (!debugApiEnabled) {
        storageLine.textContent = "Debug API 未启用。请以 --web-debug-api true 启动服务。";
        return;
      }
      if (debugAdminTokenRequired && !debugAdminToken) {
        const entered = promptAdminToken();
        if (!entered) {
          storageLine.textContent = "Debug API 需要 admin token。";
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
      setBusy(true, "trace");
      try {
        const response = await fetch("/api/debug/traces?limit=" + String(limit), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", "Trace API 未启用。请以 --web-debug-api true 启动服务。");
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
          addBubble("assistant", "Trace API 鉴权失败，请提供正确的 admin token。");
          return;
        }
        if (!response.ok) throw new Error("trace failed");
        const payload = await response.json();
        addBubble("assistant", JSON.stringify(payload, null, 2));
      } catch {
        addBubble("assistant", "Trace 获取失败，请稍后重试。");
      } finally {
        setBusy(false, "ready");
      }
    }

    async function handleTraceClearCommand(allowAuthRetry = true) {
      setBusy(true, "trace");
      try {
        const response = await fetch("/api/debug/traces/clear", {
          method: "POST",
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", "Trace API 未启用。请以 --web-debug-api true 启动服务。");
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
          addBubble("assistant", "Trace API 鉴权失败，请提供正确的 admin token。");
          return;
        }
        if (!response.ok) throw new Error("trace clear failed");
        addBubble("assistant", "trace 已清空。");
        if (debugVisible) {
          await refreshDebug();
        }
      } catch {
        addBubble("assistant", "Trace 清空失败，请稍后重试。");
      } finally {
        setBusy(false, "ready");
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

    async function sendMessage(text) {
      addBubble("user", text);
      const assistantBubble = addBubble("assistant", "");
      assistantBubble.classList.add("streaming");
      setBusy(true, "thinking");

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });

        if (!response.ok || !response.body) {
          const fallback = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text })
          });
          if (!fallback.ok) {
            throw new Error("fallback chat failed");
          }
          const data = await fallback.json();
          const replyText = typeof data.reply === "string" ? data.reply : "请求失败";
          const proactiveText = typeof data.proactiveReply === "string" ? data.proactiveReply : "";
          assistantBubble.textContent = proactiveText
            ? replyText + "\\n\\n" + proactiveText
            : replyText;
          assistantBubble.classList.remove("streaming");
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
        let textSoFar = "";
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
              renderRawContext(parsed.data?.rawContext ?? {
                formatted: parsed.data?.context ?? "",
                blocks: Array.isArray(parsed.data?.blocks) ? parsed.data.blocks : [],
                prediction: parsed.data?.prediction ?? null
              });
              await updateDebug();
            } else if (parsed.event === "error") {
              assistantBubble.textContent = "[stream error] " + (parsed.data?.error ?? "unknown");
              assistantBubble.classList.remove("streaming");
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
            boundary = buffer.indexOf("\\n\\n");
          }
        }
      } catch (error) {
        assistantBubble.textContent = "请求失败，请检查服务状态。";
        assistantBubble.classList.remove("streaming");
      } finally {
        setBusy(false, "ready");
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

    async function updateDebug() {
      if (!debugVisible) return;
      await refreshDebug();
    }

    async function refreshDebug(allowAuthRetry = true) {
      if (!debugApiEnabled) {
        storageLine.textContent = "Debug API 未启用。";
        return;
      }
      try {
        const response = await fetch("/api/debug/database", {
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
          storageLine.textContent = "Debug API 鉴权失败，请提供正确的 admin token。";
          return;
        }
        if (!response.ok) throw new Error("debug fetch failed");
        const snapshot = await response.json();
        latestDebug = snapshot;
        renderDebug(snapshot);
      } catch {
        storageLine.textContent = "调试数据加载失败，请稍后重试。";
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
        "raw " + rawCount + " / compressed " + compressedCount + " / conflict " + conflictCount;

      const contextBlocks = Array.isArray(context?.blocks) ? context.blocks : [];
      const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
      const relations = Array.isArray(snapshot.relations) ? snapshot.relations : [];

      contextMeta.textContent = context
        ? "query: " + (context.query ?? "-") + " · " + contextBlocks.length
        : "0";
      blocksMeta.textContent = String(blocks.length);
      relationsMeta.textContent = String(relations.length);

      renderContextRows(contextBlocks);
      renderBlockRows(blocks);
      renderRelationRows(relations);
    }

    function renderContextRows(items) {
      contextRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        contextRows.appendChild(buildEmptyRow(6, "暂无上下文块"));
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
        blockRows.appendChild(buildEmptyRow(7, "暂无数据库分块"));
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
        const inCtxCell = buildCell(item.inContext ? "Y" : "-");
        if (item.inContext) inCtxCell.className = "context-yes";
        row.appendChild(inCtxCell);
        blockRows.appendChild(row);
      }
    }

    function renderRelationRows(items) {
      relationRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        relationRows.appendChild(buildEmptyRow(5, "暂无关系数据"));
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
        const response = await fetch("/api/debug/block?id=" + encodeURIComponent(blockId), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          openModal("Block 详情", { id: blockId, error: "Debug API 未启用" });
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
            openModal("Block 详情", { id: blockId, error: "鉴权失败" });
            return;
          }
          openModal("Block 详情", { id: blockId, error: "鉴权失败" });
          return;
        }
        if (!response.ok) throw new Error("detail failed");
        const detail = await response.json();
        openModal("Block 详情: " + shortId(blockId), detail);
      } catch {
        openModal("Block 详情", { id: blockId, error: "加载失败" });
      }
    }

    function onContextRowClick(event) {
      const row = event.target.closest("tr[data-id]");
      if (!row || !latestDebug || !latestDebug.lastContext) return;
      const blockId = row.dataset.id;
      const item = (latestDebug.lastContext.blocks ?? []).find((candidate) => candidate.id === blockId);
      if (!item) return;
      openModal("Context Block: " + shortId(blockId), item);
    }

    function onRelationRowClick(event) {
      const row = event.target.closest("tr[data-index]");
      if (!row || !latestDebug) return;
      const index = Number.parseInt(row.dataset.index ?? "-1", 10);
      if (!Number.isFinite(index) || index < 0) return;
      const item = (latestDebug.relations ?? [])[index];
      if (!item) return;
      openModal("Relation 详情", item);
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
      return text.slice(0, 8) + "..." + text.slice(-4);
    }

    function fmtNum(value, digits) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) return "0";
      return number.toFixed(digits);
    }

    function fmtTime(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number <= 0) return "-";
      try {
        return new Date(number).toLocaleString();
      } catch {
        return String(number);
      }
    }

    function fmtTimeRange(start, end) {
      const left = fmtTime(start);
      const right = fmtTime(end);
      if (left === "-" && right === "-") return "-";
      if (left === right) return left;
      return left + " → " + right;
    }

    function formatStorage(storage) {
      const parts = [];
      parts.push("storage=" + String(storage.storageBackend ?? "-"));
      parts.push("raw=" + String(storage.rawStoreBackend ?? "-"));
      parts.push("relation=" + String(storage.relationStoreBackend ?? "-"));
      if (storage.sqliteFilePath) parts.push("sqlite=" + storage.sqliteFilePath);
      if (storage.sqliteFileSizeBytes != null) {
        parts.push("sqliteSize=" + formatBytes(storage.sqliteFileSizeBytes));
      }
      if (storage.lanceFilePath) parts.push("lance=" + storage.lanceFilePath);
      if (storage.rawStoreFilePath) parts.push("rawFile=" + storage.rawStoreFilePath);
      if (storage.relationStoreFilePath) parts.push("relationFile=" + storage.relationStoreFilePath);
      return parts.join(" | ");
    }

    function formatBytes(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number < 0) return "-";
      if (number < 1024) return number + " B";
      if (number < 1024 * 1024) return (number / 1024).toFixed(1) + " KB";
      return (number / (1024 * 1024)).toFixed(2) + " MB";
    }

    function renderRawContext(rawContext) {
      if (!rawContextView) return;
      rawContextView.textContent = JSON.stringify(rawContext ?? { empty: true }, null, 2);
    }

    async function initializeCapabilities() {
      try {
        const response = await fetch("/api/capabilities");
        if (!response.ok) throw new Error("capabilities failed");
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
        debugBtn.textContent = "Debug...";
        debugBtn.disabled = true;
        return;
      }
      if (!debugApiEnabled) {
        debugBtn.textContent = "Debug Off";
        debugBtn.disabled = true;
        return;
      }
      debugBtn.disabled = false;
      debugBtn.textContent = debugVisible ? "Debug On" : "Debug";
    }

    function disableDebugApi() {
      debugApiEnabled = false;
      debugVisible = false;
      debugPanel.hidden = true;
      renderDebugButtonState();
      storageLine.textContent = "Debug API 未启用（服务端返回 404）。";
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
      const entered = window.prompt("请输入 Debug API admin token", current);
      if (typeof entered !== "string") return "";
      const normalized = entered.trim();
      if (normalized.length === 0) return "";
      debugAdminToken = normalized;
      try {
        window.localStorage.setItem("mlex.debugAdminToken", normalized);
      } catch {}
      return normalized;
    }
  </script>
</body>
</html>`;
}

