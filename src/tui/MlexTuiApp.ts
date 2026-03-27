import blessed from "blessed";

import type { AppConfig } from "../config.js";
import type { Runtime } from "../container.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  ReadonlyFileService,
  type ReadFileResult,
  type ReadonlyFileEntry
} from "../files/ReadonlyFileService.js";
import { parseTuiInput, type TuiInputAction } from "./chatCommand.js";

const MAX_INSPECTOR_CHARS = 60_000;
const MAX_ACTIVITY_LINES = 200;
const DEFAULT_TRACE_LIMIT = 200;
const MAX_TRACE_LIMIT = 5_000;
const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_READ_MAX_BYTES = 64 * 1024;
const SESSION_TITLE_PREFIX = "Session";

type ConversationRole = "user" | "assistant" | "system";
type AgentMode = "chat" | "code" | "plan";
type ActivityLevel = "info" | "warn" | "error";

interface ConversationEntry {
  role: ConversationRole;
  text: string;
  at: number;
  streaming?: boolean;
}

interface ActivityEntry {
  level: ActivityLevel;
  text: string;
  at: number;
}

interface SessionState {
  id: string;
  title: string;
  timeline: ConversationEntry[];
  createdAt: number;
  updatedAt: number;
}

interface StreamRequestState {
  id: number;
  controller: AbortController;
  sessionId: string;
  userInput: string;
  assistantIndex: number;
  partialText: string;
  interrupted: boolean;
}

const THEME = {
  paneBg: "black",
  paneFg: "gray",
  border: "light-black",
  headerBg: "black",
  headerFg: "light-black",
  statusBg: "black",
  statusFg: "light-black",
  scrollbarTrack: "black",
  scrollbarThumb: "light-black",
  selectedBg: "light-black",
  selectedFg: "white"
} as const;

export interface MlexTuiAppOptions {
  runtime: Runtime;
  fileService: ReadonlyFileService;
  traceRecorder: IDebugTraceRecorder;
  streamEnabled: boolean;
  showContextByDefault: boolean;
  sanitizeConfig(config: AppConfig): AppConfig;
}

export class MlexTuiApp {
  private readonly screen: blessed.Widgets.Screen;
  private readonly header: blessed.Widgets.BoxElement;
  private readonly sessionList: blessed.Widgets.ListElement;
  private readonly conversation: blessed.Widgets.BoxElement;
  private readonly sidebar: blessed.Widgets.BoxElement;
  private readonly activity: blessed.Widgets.BoxElement;
  private readonly inspector: blessed.Widgets.BoxElement;
  private readonly inputBox: blessed.Widgets.TextboxElement;
  private readonly statusBar: blessed.Widgets.BoxElement;
  private readonly sessions: SessionState[] = [];
  private readonly activityTrail: ActivityEntry[] = [];
  private activeSessionIndex = 0;
  private streamRequestCounter = 0;
  private activeStream?: StreamRequestState;
  private scheduleResendAfterInterrupt = false;
  private lastUserPrompt?: string;
  private lastInterruptedPrompt?: string;
  private donePromise?: Promise<void>;
  private doneResolve?: () => void;
  private busy = false;
  private closing = false;
  private streamEnabled: boolean;
  private readonly showContextByDefault: boolean;
  private mode: AgentMode = "chat";

  constructor(private readonly options: MlexTuiAppOptions) {
    this.streamEnabled = options.streamEnabled;
    this.showContextByDefault = options.showContextByDefault;

    this.screen = blessed.screen({
      smartCSR: true,
      dockBorders: true,
      fullUnicode: true,
      forceUnicode: true,
      title: "MLEX TUI"
    });

    this.header = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: {
        fg: THEME.headerFg,
        bg: THEME.headerBg
      }
    });

    this.sessionList = blessed.list({
      parent: this.screen,
      top: 1,
      left: 0,
      width: "22%",
      height: "100%-5",
      label: " Sessions ",
      border: "line",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        border: {
          fg: THEME.border
        },
        fg: THEME.paneFg,
        bg: THEME.paneBg,
        selected: {
          fg: THEME.selectedFg,
          bg: THEME.selectedBg
        },
        item: {
          fg: THEME.paneFg,
          bg: THEME.paneBg
        }
      },
      scrollbar: {
        ch: " ",
        track: {
          bg: THEME.scrollbarTrack
        },
        style: {
          bg: THEME.scrollbarThumb
        }
      }
    });

    this.conversation = blessed.box({
      parent: this.screen,
      top: 1,
      left: "22%",
      width: "46%",
      height: "100%-5",
      label: " Session ",
      border: "line",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: THEME.scrollbarTrack
        },
        style: {
          bg: THEME.scrollbarThumb
        }
      },
      style: {
        border: {
          fg: THEME.border
        },
        fg: THEME.paneFg,
        bg: THEME.paneBg
      }
    });

    this.sidebar = blessed.box({
      parent: this.screen,
      top: 1,
      left: "68%",
      width: "32%",
      height: "100%-5",
      style: {
        bg: THEME.paneBg
      }
    });

    this.activity = blessed.box({
      parent: this.sidebar,
      top: 0,
      left: 0,
      width: "100%",
      height: "40%",
      label: " Activity ",
      border: "line",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: " ",
        track: {
          bg: THEME.scrollbarTrack
        },
        style: {
          bg: THEME.scrollbarThumb
        }
      },
      style: {
        border: {
          fg: THEME.border
        },
        fg: THEME.paneFg,
        bg: THEME.paneBg
      }
    });

    this.inspector = blessed.box({
      parent: this.sidebar,
      top: "40%",
      left: 0,
      width: "100%",
      height: "60%",
      label: " Inspector ",
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollbar: {
        ch: " ",
        track: {
          bg: THEME.scrollbarTrack
        },
        style: {
          bg: THEME.scrollbarThumb
        }
      },
      style: {
        border: {
          fg: THEME.border
        },
        fg: THEME.paneFg,
        bg: THEME.paneBg
      }
    });

    this.inputBox = blessed.textbox({
      parent: this.screen,
      bottom: 1,
      left: 0,
      width: "100%",
      height: 4,
      border: "line",
      inputOnFocus: true,
      label: " Prompt (Enter send, Ctrl+X stop, Ctrl+R resend, Ctrl+K palette) ",
      keys: true,
      mouse: true,
      style: {
        border: {
          fg: THEME.border
        },
        fg: THEME.paneFg,
        bg: THEME.paneBg
      }
    });

    this.statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: {
        fg: THEME.statusFg,
        bg: THEME.statusBg
      }
    });

    this.screen.on("warning", (text) => {
      this.pushActivity("warn", text);
      this.setInspector("Terminal Warning", text);
      this.setStatus("Terminal warning received.");
      this.screen.render();
    });

    this.createSession(false);
  }

  async run(): Promise<void> {
    if (this.donePromise) return this.donePromise;
    this.donePromise = new Promise<void>((resolve) => {
      this.doneResolve = resolve;
    });

    this.registerEvents();
    this.refreshHeader();
    this.renderSessionList(false);
    this.renderConversation(false);
    this.renderActivity(false);
    this.renderQuickPalette();
    this.addSystemLine("MLEX Workspace 已启动。输入 /help 查看命令。");
    this.pushActivity("info", "Session started.");
    this.setStatus("Ready");
    this.focusInput();
    this.screen.render();

    return this.donePromise;
  }

  private registerEvents(): void {
    this.screen.key(["C-c"], () => {
      void this.requestExit();
    });
    this.screen.key(["C-s"], () => {
      void this.executeAction({ type: "seal" });
    });
    this.screen.key(["C-p"], () => {
      this.streamEnabled = !this.streamEnabled;
      this.pushActivity("info", `Streaming ${this.streamEnabled ? "enabled" : "disabled"}.`);
      this.refreshHeader();
      this.setStatus(`Streaming ${this.streamEnabled ? "ON" : "OFF"}`);
      this.screen.render();
    });
    this.screen.key(["C-t"], () => {
      void this.executeAction({ type: "trace", limit: DEFAULT_TRACE_LIMIT });
    });
    this.screen.key(["C-k"], () => {
      this.renderQuickPalette();
      this.pushActivity("info", "Opened quick palette.");
      this.inspector.focus();
      this.screen.render();
    });
    this.screen.key(["C-x"], () => {
      this.requestInterrupt("hotkey");
    });
    this.screen.key(["C-r"], () => {
      if (this.busy && this.activeStream) {
        this.requestInterrupt("hotkey", true);
        return;
      }
      void this.executeAction({ type: "resend" });
    });
    this.screen.key(["C-1"], () => {
      this.setMode("chat", "hotkey");
    });
    this.screen.key(["C-2"], () => {
      this.setMode("code", "hotkey");
    });
    this.screen.key(["C-3"], () => {
      this.setMode("plan", "hotkey");
    });
    this.screen.key(["C-n"], () => {
      void this.executeAction({ type: "newChat" });
    });
    this.screen.key(["C-l"], () => {
      const session = this.getActiveSession();
      session.timeline.length = 0;
      session.updatedAt = Date.now();
      this.renderSessionList(false);
      this.renderConversation(false);
      this.pushActivity("info", `Cleared messages in ${session.title}.`);
      this.setStatus("Current session cleared.");
      this.screen.render();
      this.focusInput();
    });
    this.screen.key(["tab"], () => {
      if (this.screen.focused === this.inputBox) {
        this.sessionList.focus();
        this.setStatus("Focus: Sessions");
      } else if (this.screen.focused === this.sessionList) {
        this.conversation.focus();
        this.setStatus("Focus: Session");
      } else if (this.screen.focused === this.conversation) {
        this.activity.focus();
        this.setStatus("Focus: Activity");
      } else if (this.screen.focused === this.activity) {
        this.inspector.focus();
        this.setStatus("Focus: Inspector");
      } else {
        this.focusInput();
        this.setStatus("Focus: Prompt");
      }
      this.screen.render();
    });

    this.sessionList.on("select", (_item, selected) => {
      this.onSessionSelect(selected);
    });

    this.inputBox.key(["C-e"], () => {
      this.openEditorForInput();
    });
    this.inputBox.on("submit", () => {
      const input = this.inputBox.getValue();
      this.inputBox.clearValue();
      this.screen.render();
      void this.handleInput(input);
      setTimeout(() => {
        this.focusInput();
      }, 0);
    });
    this.inputBox.on("cancel", () => {
      this.setStatus("Input canceled.");
      this.screen.render();
    });
  }

  private onSessionSelect(index: number): void {
    if (this.closing) return;
    if (this.busy) {
      this.sessionList.select(this.activeSessionIndex);
      this.setStatus("Busy: wait for current request.");
      this.screen.render();
      return;
    }
    this.setActiveSession(index, "list");
  }

  private setMode(nextMode: AgentMode, source: "hotkey" | "command"): void {
    if (this.mode === nextMode) {
      this.setStatus(`Mode already: ${nextMode}`);
      this.screen.render();
      return;
    }
    this.mode = nextMode;
    this.pushActivity("info", `Mode -> ${nextMode} (${source}).`);
    this.refreshHeader();
    this.setStatus(`Mode switched to ${nextMode}`);
    this.renderQuickPalette();
    this.screen.render();
  }

  private createSession(switchToNew: boolean): SessionState {
    const now = Date.now();
    const index = this.sessions.length + 1;
    const session: SessionState = {
      id: `s-${now}-${index}`,
      title: `${SESSION_TITLE_PREFIX} ${index}`,
      timeline: [],
      createdAt: now,
      updatedAt: now
    };
    this.sessions.push(session);

    if (switchToNew || this.sessions.length === 1) {
      this.activeSessionIndex = this.sessions.length - 1;
    }
    this.renderSessionList(false);
    this.refreshHeader();
    return session;
  }

  private setActiveSession(index: number, source: "list" | "command" | "new"): void {
    if (index < 0 || index >= this.sessions.length) return;
    if (this.activeSessionIndex === index) {
      this.sessionList.select(index);
      this.screen.render();
      return;
    }

    this.activeSessionIndex = index;
    const session = this.getActiveSession();
    this.renderSessionList(false);
    this.renderConversation(false);
    this.refreshHeader();
    if (source !== "new") {
      this.pushActivity("info", `Switched to ${session.title} (${source}).`);
    }
    this.setStatus(`Active session: ${session.title}`);
    this.screen.render();
    this.focusInput();
  }

  private getActiveSession(): SessionState {
    if (!this.sessions[this.activeSessionIndex]) {
      return this.createSession(true);
    }
    return this.sessions[this.activeSessionIndex];
  }

  private focusInput(): void {
    if (this.closing) return;
    this.inputBox.focus();
  }

  private openEditorForInput(): void {
    if (this.closing) return;
    this.setStatus("Opening $EDITOR...");
    this.screen.render();
    this.inputBox.readEditor((error, value) => {
      if (error) {
        this.addSystemLine(`打开编辑器失败: ${toErrorMessage(error)}`);
        this.pushActivity("error", `Editor open failed: ${toErrorMessage(error)}`);
        this.setStatus("Editor failed.");
        this.screen.render();
        this.focusInput();
        return;
      }
      if (typeof value === "string" && value.length > 0) {
        this.inputBox.setValue(value.trim());
      }
      this.pushActivity("info", "Editor input applied.");
      this.setStatus("Editor applied.");
      this.screen.render();
      this.focusInput();
    });
  }

  private async handleInput(rawInput: string): Promise<void> {
    const action = parseTuiInput(rawInput);
    if (action.type === "invalid") {
      this.addSystemLine(action.reason);
      this.pushActivity("warn", action.reason);
      this.setStatus("Invalid command.");
      this.screen.render();
      return;
    }
    await this.executeAction(action);
  }

  private requestInterrupt(source: "command" | "hotkey", queueResend = false): void {
    const stream = this.activeStream;
    if (!stream) {
      this.setStatus("No active streaming response.");
      this.screen.render();
      return;
    }

    if (queueResend) {
      this.scheduleResendAfterInterrupt = true;
    }

    if (stream.controller.signal.aborted) {
      this.setStatus("Interrupt already requested.");
      this.screen.render();
      return;
    }

    stream.interrupted = true;
    stream.controller.abort();
    this.pushActivity(
      "warn",
      `Interrupt requested (${source}${queueResend ? ", resend queued" : ""}).`
    );
    this.setStatus(queueResend ? "Interrupting, resend queued..." : "Interrupting...");
    this.refreshHeader();
    this.screen.render();
  }

  private isActiveStream(id: number): boolean {
    return this.activeStream?.id === id;
  }

  private async resendLastPrompt(): Promise<void> {
    const prompt = this.lastInterruptedPrompt ?? this.lastUserPrompt;
    if (!prompt) {
      this.addSystemLine("没有可重发的用户消息。先发送一条消息。");
      this.pushActivity("warn", "Resend requested but no prompt exists.");
      this.setStatus("No prompt to resend.");
      return;
    }

    this.pushActivity("info", `Resending prompt (${prompt.length} chars).`);
    this.addSystemLine("重发上一条用户消息。");
    this.setStatus("Resending...");
    await this.handleMessage(prompt);
  }

  private async executeAction(action: TuiInputAction): Promise<void> {
    if (action.type === "exit") {
      await this.requestExit();
      return;
    }

    if (action.type === "interrupt") {
      this.requestInterrupt("command");
      return;
    }

    if (action.type === "resend" && this.busy && this.activeStream) {
      this.requestInterrupt("command", true);
      return;
    }

    if (this.busy) {
      this.addSystemLine("系统正在处理上一条请求，请稍候。流式中可用 /stop 或 Ctrl+X 打断。");
      this.pushActivity("warn", "Busy: ignored new action.");
      this.setStatus("Busy.");
      this.screen.render();
      return;
    }

    this.busy = true;
    this.refreshHeader();
    this.screen.render();

    try {
      switch (action.type) {
        case "newChat": {
          const session = this.createSession(true);
          this.renderSessionList(false);
          this.renderConversation(false);
          this.addSystemLine(`已创建新会话：${session.title}。`);
          this.pushActivity("info", `Created ${session.title}.`);
          this.setStatus(`${session.title} ready.`);
          this.renderQuickPalette();
          break;
        }
        case "mode":
          this.setMode(action.mode, "command");
          break;
        case "resend":
          await this.resendLastPrompt();
          break;
        case "message":
          await this.handleMessage(action.text);
          break;
        case "help":
          this.renderQuickPalette();
          this.pushActivity("info", "Displayed help panel.");
          this.addSystemLine("帮助已显示在右侧 Inspector。");
          break;
        case "seal":
          await this.options.runtime.agent.sealMemory();
          this.pushActivity("info", "Sealed current active block.");
          this.addSystemLine("当前 active block 已封存。");
          break;
        case "context": {
          const context = await this.options.runtime.agent.getContext(action.query);
          this.setInspector("Context", context.formatted);
          this.pushActivity("info", `Loaded context: ${context.blocks.length} blocks.`);
          this.addSystemLine(`上下文已载入：${context.blocks.length} blocks。`);
          break;
        }
        case "config": {
          const sanitized = this.options.sanitizeConfig(this.options.runtime.config);
          this.setInspector("Config", JSON.stringify(sanitized, null, 2));
          this.pushActivity("info", "Loaded runtime config.");
          this.addSystemLine("配置已显示（敏感字段已脱敏）。");
          break;
        }
        case "trace": {
          const limit = Math.min(Math.max(action.limit ?? DEFAULT_TRACE_LIMIT, 1), MAX_TRACE_LIMIT);
          const entries = this.options.traceRecorder.list(limit);
          const payload = {
            total: this.options.traceRecorder.size(),
            entries
          };
          this.setInspector("Trace", JSON.stringify(payload, null, 2));
          this.pushActivity("info", `Loaded trace entries: ${entries.length}/${payload.total}.`);
          this.addSystemLine(`Trace 已加载：${entries.length}/${payload.total}。`);
          break;
        }
        case "traceClear":
          this.options.traceRecorder.clear();
          this.pushActivity("info", "Trace cleared.");
          this.addSystemLine("Trace 已清空。");
          break;
        case "list": {
          const entries = await this.options.fileService.list(action.path, DEFAULT_LIST_LIMIT);
          this.setInspector("Files", formatFileList(entries, action.path));
          this.pushActivity("info", `Listed files: ${action.path}`);
          this.addSystemLine(`已列出目录：${action.path}`);
          break;
        }
        case "read": {
          const result = await this.options.fileService.read(action.path, DEFAULT_READ_MAX_BYTES);
          this.setInspector("File", formatFileRead(result));
          this.pushActivity("info", `Read file: ${action.path}`);
          this.addSystemLine(`已读取文件：${action.path}`);
          break;
        }

        case "invalid":
          this.pushActivity("warn", action.reason);
          this.addSystemLine(action.reason);
          break;
      }
      this.setStatus("Ready");
    } catch (error) {
      const message = toErrorMessage(error);
      this.pushActivity("error", message);
      this.addSystemLine(`执行失败: ${message}`);
      this.setStatus("Error");
    } finally {
      this.busy = false;
      this.refreshHeader();
      this.screen.render();
      this.focusInput();
    }
  }

  private async handleMessage(input: string): Promise<void> {
    this.lastUserPrompt = input;
    this.addUserLine(input);
    this.pushActivity("info", `User prompt (${input.length} chars).`);

    if (this.streamEnabled) {
      this.setStatus("Streaming...");
      const session = this.getActiveSession();
      const requestId = ++this.streamRequestCounter;
      const assistantIndex = this.appendConversation("assistant", "", true);
      const stream: StreamRequestState = {
        id: requestId,
        controller: new AbortController(),
        sessionId: session.id,
        userInput: input,
        assistantIndex,
        partialText: "",
        interrupted: false
      };
      this.activeStream = stream;
      this.refreshHeader();
      this.screen.render();

      try {
        const response = await this.options.runtime.agent.respondStream(
          input,
          (token) => {
            if (!this.isActiveStream(requestId)) return;
            if (stream.controller.signal.aborted || stream.interrupted) return;
            stream.partialText += token;
            this.updateConversation(assistantIndex, stream.partialText, true);
            this.setStatus(`Streaming ${stream.partialText.length} chars...`);
            this.screen.render();
          },
          { signal: stream.controller.signal }
        );

        if (!this.isActiveStream(requestId)) {
          return;
        }

        this.updateConversation(assistantIndex, response.text, false);
        if (response.proactiveText) {
          this.addAgentLine(response.proactiveText);
          this.pushActivity("info", `Proactive wakeup (${response.proactiveText.length} chars, stream).`);
        }
        this.lastInterruptedPrompt = undefined;
        this.pushActivity("info", `Assistant replied (${response.text.length} chars, stream).`);
        this.showPostResponseInspector(response.text, response.context.formatted);
        return;
      } catch (error) {
        const interrupted =
          stream.interrupted || stream.controller.signal.aborted || isAbortError(error);
        if (!interrupted) {
          throw error;
        }

        const interruptedText = formatInterruptedAssistantText(stream.partialText);
        this.updateConversation(assistantIndex, interruptedText, false);
        this.lastInterruptedPrompt = input;
        this.pushActivity("warn", "Assistant response interrupted.");
        this.setInspector(
          "Interrupted",
          "当前回复已打断。可输入 /resend、/retry，或按 Ctrl+R 重新发送。"
        );

        if (this.isActiveStream(requestId)) {
          this.activeStream = undefined;
        }
        this.refreshHeader();

        const shouldAutoResend = this.scheduleResendAfterInterrupt;
        this.scheduleResendAfterInterrupt = false;

        if (shouldAutoResend) {
          this.setStatus("Interrupted. Resending...");
          this.screen.render();
          await this.handleMessage(input);
          return;
        }

        this.addSystemLine("当前回复已中断。可用 /resend 或 Ctrl+R 重发。输入 /stop 可再次打断。");
        this.setStatus("Interrupted.");
        this.screen.render();
        return;
      } finally {
        if (this.isActiveStream(requestId)) {
          this.activeStream = undefined;
        }
      }
    }

    this.setStatus("Thinking...");
    const response = await this.options.runtime.agent.respond(input);
    this.addAgentLine(response.text);
    if (response.proactiveText) {
      this.addAgentLine(response.proactiveText);
      this.pushActivity("info", `Proactive wakeup (${response.proactiveText.length} chars).`);
    }
    this.lastInterruptedPrompt = undefined;
    this.pushActivity("info", `Assistant replied (${response.text.length} chars).`);
    this.showPostResponseInspector(response.text, response.context.formatted);
  }

  private showPostResponseInspector(responseText: string, formattedContext: string): void {
    if (this.showContextByDefault) {
      this.setInspector("Context", formattedContext);
      return;
    }
    this.setInspector("Assistant", responseText);
  }

  private refreshHeader(): void {
    const state = this.activeStream
      ? "{yellow-fg}STREAM{/yellow-fg}"
      : this.busy
        ? "{yellow-fg}BUSY{/yellow-fg}"
        : "{gray-fg}READY{/gray-fg}";
    const stream = this.streamEnabled ? "{cyan-fg}ON{/cyan-fg}" : "{light-black-fg}OFF{/light-black-fg}";
    const mode =
      this.mode === "code"
        ? "{cyan-fg}CODE{/cyan-fg}"
        : this.mode === "plan"
          ? "{yellow-fg}PLAN{/yellow-fg}"
          : "{gray-fg}CHAT{/gray-fg}";
    const activeSession = this.getActiveSession();
    const messages = `{gray-fg}${activeSession.timeline.length}{/gray-fg}`;
    const sessions = `{gray-fg}${this.sessions.length}{/gray-fg}`;
    this.header.setContent(
      ` MLEX Workspace | State: ${state} | Mode: ${mode} | Stream: ${stream} | Sessions: ${sessions} | Msg: ${messages} | Ctrl+X Stop | Ctrl+R Resend | Ctrl+K Palette | Ctrl+C Exit `
    );
  }

  private setStatus(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.statusBar.setContent(` ${timestamp} | ${message}`);
  }

  private setInspector(title: string, content: string): void {
    this.inspector.setLabel(` ${title} `);
    this.inspector.setContent(limitInspectorContent(content));
    this.inspector.setScrollPerc(0);
  }

  private renderQuickPalette(): void {
    const lines = [
      "Mode",
      `current: ${this.mode}`,
      "/mode chat|code|plan",
      "",
      "Session",
      "/new (or /clear)",
      "/resend (or /retry)",
      "/stop",
      "/seal",
      "/ctx <query>",
      "/trace [n]",
      "/trace-clear",
      "",
      "Files",
      "/ls [path]",
      "/cat <file>",
      "",
      "Hotkeys",
      "Ctrl+1 chat mode",
      "Ctrl+2 code mode",
      "Ctrl+3 plan mode",
      "Ctrl+K quick palette",
      "Ctrl+N new session",
      "Ctrl+R resend",
      "Ctrl+X stop streaming",
      "Ctrl+S seal",
      "Ctrl+P stream on/off",
      "Ctrl+T trace",
      "Ctrl+L clear current session",
      "Ctrl+E external editor",
      "Tab focus cycle"
    ];
    this.setInspector("Quick Palette", lines.join("\n"));
  }

  private addUserLine(content: string): void {
    this.appendConversation("user", content, false);
  }

  private addAgentLine(content: string): void {
    this.appendConversation("assistant", content, false);
  }

  private addSystemLine(content: string): void {
    this.appendConversation("system", content, false);
  }

  private appendConversation(role: ConversationRole, content: string, streaming: boolean): number {
    const session = this.getActiveSession();
    session.timeline.push({ role, text: content, at: Date.now(), streaming });
    session.updatedAt = Date.now();
    this.renderSessionList(false);
    this.renderConversation(true);
    this.refreshHeader();
    return session.timeline.length - 1;
  }

  private updateConversation(index: number, content: string, streaming: boolean): void {
    const session = this.getActiveSession();
    const entry = session.timeline[index];
    if (!entry) return;
    entry.text = content;
    entry.streaming = streaming;
    session.updatedAt = Date.now();
    this.renderSessionList(false);
    this.renderConversation(true);
    this.refreshHeader();
  }

  private renderSessionList(autoFocusSelection: boolean): void {
    if (this.sessions.length === 0) {
      this.sessionList.setItems(["(no sessions)"]);
      this.sessionList.select(0);
      return;
    }

    const items = this.sessions.map((session, index) => {
      const activeMarker = index === this.activeSessionIndex ? "●" : " ";
      const updated = new Date(session.updatedAt).toLocaleTimeString();
      const count = session.timeline.length;
      return `${activeMarker} ${session.title}  ${count} msg  ${updated}`;
    });

    this.sessionList.setItems(items);
    this.sessionList.select(this.activeSessionIndex);
    if (autoFocusSelection) {
      this.sessionList.focus();
    }
  }

  private renderConversation(autoScroll: boolean): void {
    const session = this.getActiveSession();
    this.conversation.setLabel(` ${session.title} `);

    if (session.timeline.length === 0) {
      this.conversation.setContent("{light-black-fg}(empty session){/light-black-fg}");
      if (autoScroll) this.conversation.setScrollPerc(100);
      return;
    }

    const divider = "{light-black-fg}────────────────────────────────────────{/light-black-fg}";
    const content = session.timeline.map((entry) => formatConversationEntry(entry)).join(`\n${divider}\n`);
    this.conversation.setContent(content);
    if (autoScroll) this.conversation.setScrollPerc(100);
  }

  private pushActivity(level: ActivityLevel, text: string): void {
    this.activityTrail.push({ level, text, at: Date.now() });
    if (this.activityTrail.length > MAX_ACTIVITY_LINES) {
      this.activityTrail.splice(0, this.activityTrail.length - MAX_ACTIVITY_LINES);
    }
    this.renderActivity(true);
  }

  private renderActivity(autoScroll: boolean): void {
    if (this.activityTrail.length === 0) {
      this.activity.setContent("{light-black-fg}(no activity){/light-black-fg}");
      if (autoScroll) this.activity.setScrollPerc(100);
      return;
    }
    const content = this.activityTrail.map((entry) => formatActivityEntry(entry)).join("\n");
    this.activity.setContent(content);
    if (autoScroll) this.activity.setScrollPerc(100);
  }

  private async requestExit(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.activeStream && !this.activeStream.controller.signal.aborted) {
      this.activeStream.controller.abort();
    }
    this.setStatus("Exiting...");
    this.screen.render();
    this.screen.destroy();
    this.doneResolve?.();
  }
}

function formatConversationEntry(entry: ConversationEntry): string {
  const timestamp = new Date(entry.at).toLocaleTimeString();
  const role =
    entry.role === "user"
      ? "{gray-fg}[YOU]{/gray-fg}"
      : entry.role === "assistant"
        ? "{cyan-fg}[AI]{/cyan-fg}"
        : "{light-black-fg}[SYS]{/light-black-fg}";
  const body = blessed.escape(formatForDisplay(entry.text));
  const suffix = entry.streaming ? "\n{light-black-fg}▌ streaming...{/light-black-fg}" : "";
  return `{bold}${role} ${timestamp}{/bold}\n${body}${suffix}`;
}

function formatActivityEntry(entry: ActivityEntry): string {
  const timestamp = new Date(entry.at).toLocaleTimeString();
  const level =
    entry.level === "error"
      ? "{red-fg}[ERR]{/red-fg}"
      : entry.level === "warn"
        ? "{yellow-fg}[WRN]{/yellow-fg}"
        : "{cyan-fg}[INF]{/cyan-fg}";
  return `${level} {light-black-fg}${timestamp}{/light-black-fg} ${blessed.escape(entry.text)}`;
}

function formatForDisplay(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "(empty)";
  return normalized
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatInterruptedAssistantText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "(interrupted)";
  }
  return `${trimmed}\n\n[interrupted]`;
}

function formatFileList(entries: ReadonlyFileEntry[], pathInput: string): string {
  const header = `path: ${pathInput}`;
  if (entries.length === 0) {
    return `${header}\n(empty)`;
  }
  const lines = entries.map((entry) => {
    const prefix = entry.type === "dir" ? "[dir] " : entry.type === "file" ? "[file]" : "[other]";
    const sizePart = typeof entry.sizeBytes === "number" ? ` ${entry.sizeBytes}B` : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function formatFileRead(result: ReadFileResult): string {
  const meta = `${result.path} (${result.bytes}/${result.totalBytes} bytes${result.truncated ? ", truncated" : ""})`;
  return `${meta}\n\n${result.text}`;
}

function limitInspectorContent(content: string): string {
  if (content.length <= MAX_INSPECTOR_CHARS) return content;
  return `${content.slice(0, MAX_INSPECTOR_CHARS)}\n\n...[truncated for inspector]`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError") {
      return true;
    }
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return true;
    }
    return /aborted|abort/i.test(error.message);
  }
  return false;
}
