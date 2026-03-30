import blessed from "blessed";

import type { I18n } from "../i18n/index.js";
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
const INTERRUPT_RETAIN_SENTENCE_LIMIT = 3;
const INTERRUPT_RETAIN_FALLBACK_CHARS = 180;
const INTERRUPT_RETAIN_MAX_CHARS = 400;

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

interface InterruptedContextState {
  sessionId: string;
  originalQuestion: string;
  partialText: string;
  at: number;
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
  i18n: I18n;
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
  private pendingInterruptedContext?: InterruptedContextState;
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
      title: options.i18n.t("tui.title")
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
      label: options.i18n.t("tui.label.sessions"),
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
      label: options.i18n.t("tui.label.session"),
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
      label: options.i18n.t("tui.label.activity"),
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
      label: options.i18n.t("tui.label.inspector"),
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
      label: options.i18n.t("tui.label.prompt"),
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
      this.setInspector(this.options.i18n.t("tui.inspector.terminal_warning"), text);
      this.setStatus(this.options.i18n.t("tui.warning.terminal"));
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
    this.addSystemLine(this.options.i18n.t("tui.system.started"));
    this.pushActivity("info", this.options.i18n.t("tui.activity.session_started"));
    this.setStatus(this.options.i18n.t("tui.status.ready"));
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
      this.pushActivity("info", this.options.i18n.t("tui.activity.streaming_toggled", {
        state: this.streamEnabled
          ? this.options.i18n.t("tui.state.enabled")
          : this.options.i18n.t("tui.state.disabled")
      }));
      this.refreshHeader();
      this.setStatus(
        this.options.i18n.t("tui.status.streaming_toggled", {
          state: this.streamEnabled
            ? this.options.i18n.t("tui.state.on")
            : this.options.i18n.t("tui.state.off")
        })
      );
      this.screen.render();
    });
    this.screen.key(["C-t"], () => {
      void this.executeAction({ type: "trace", limit: DEFAULT_TRACE_LIMIT });
    });
    this.screen.key(["C-k"], () => {
      this.renderQuickPalette();
      this.pushActivity("info", this.options.i18n.t("tui.activity.quick_palette_opened"));
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
      this.pushActivity("info", this.options.i18n.t("tui.activity.current_session_cleared", { title: session.title }));
      this.setStatus(this.options.i18n.t("tui.status.current_session_cleared"));
      this.screen.render();
      this.focusInput();
    });
    this.screen.key(["tab"], () => {
      if (this.screen.focused === this.inputBox) {
        this.sessionList.focus();
        this.setStatus(this.options.i18n.t("tui.status.focus_sessions"));
      } else if (this.screen.focused === this.sessionList) {
        this.conversation.focus();
        this.setStatus(this.options.i18n.t("tui.status.focus_session"));
      } else if (this.screen.focused === this.conversation) {
        this.activity.focus();
        this.setStatus(this.options.i18n.t("tui.status.focus_activity"));
      } else if (this.screen.focused === this.activity) {
        this.inspector.focus();
        this.setStatus(this.options.i18n.t("tui.status.focus_inspector"));
      } else {
        this.focusInput();
        this.setStatus(this.options.i18n.t("tui.status.focus_prompt"));
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
      this.setStatus(this.options.i18n.t("tui.status.input_canceled"));
      this.screen.render();
    });
  }

  private onSessionSelect(index: number): void {
    if (this.closing) return;
    if (this.busy) {
      this.sessionList.select(this.activeSessionIndex);
      this.setStatus(this.options.i18n.t("tui.status.busy_wait"));
      this.screen.render();
      return;
    }
    this.setActiveSession(index, "list");
  }

  private setMode(nextMode: AgentMode, source: "hotkey" | "command"): void {
    if (this.mode === nextMode) {
      this.setStatus(this.options.i18n.t("tui.status.mode_already", { mode: nextMode }));
      this.screen.render();
      return;
    }
    this.mode = nextMode;
    this.pushActivity("info", this.options.i18n.t("tui.activity.mode_switched", { mode: nextMode, source }));
    this.refreshHeader();
    this.setStatus(this.options.i18n.t("tui.status.mode_switched", { mode: nextMode }));
    this.renderQuickPalette();
    this.screen.render();
  }

  private createSession(switchToNew: boolean): SessionState {
    const now = Date.now();
    const index = this.sessions.length + 1;
    const session: SessionState = {
      id: `s-${now}-${index}`,
      title: `${this.options.i18n.t("tui.session.title_prefix")} ${index}`,
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
      this.pushActivity("info", this.options.i18n.t("tui.activity.session_switched", { title: session.title, source }));
    }
    this.setStatus(this.options.i18n.t("tui.status.active_session", { title: session.title }));
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
    this.setStatus(this.options.i18n.t("tui.status.opening_editor"));
    this.screen.render();
    this.inputBox.readEditor((error, value) => {
      if (error) {
        this.addSystemLine(this.options.i18n.t("tui.system.editor_open_failed", { error: toErrorMessage(error) }));
        this.pushActivity(
          "error",
          this.options.i18n.t("tui.activity.editor_open_failed", { error: toErrorMessage(error) })
        );
        this.setStatus(this.options.i18n.t("tui.status.editor_failed"));
        this.screen.render();
        this.focusInput();
        return;
      }
      if (typeof value === "string" && value.length > 0) {
        this.inputBox.setValue(value.trim());
      }
      this.pushActivity("info", this.options.i18n.t("tui.activity.editor_applied"));
      this.setStatus(this.options.i18n.t("tui.status.editor_applied"));
      this.screen.render();
      this.focusInput();
    });
  }

  private async handleInput(rawInput: string): Promise<void> {
    const action = parseTuiInput(rawInput, this.options.i18n);
    if (action.type === "invalid") {
      this.addSystemLine(action.reason);
      this.pushActivity("warn", action.reason);
      this.setStatus(this.options.i18n.t("tui.status.invalid_command"));
      this.screen.render();
      return;
    }
    await this.executeAction(action);
  }

  private requestInterrupt(source: "command" | "hotkey", queueResend = false): void {
    const stream = this.activeStream;
    if (!stream) {
      this.setStatus(this.options.i18n.t("tui.status.no_active_stream"));
      this.screen.render();
      return;
    }

    if (queueResend) {
      this.scheduleResendAfterInterrupt = true;
    }

    if (stream.controller.signal.aborted) {
      this.setStatus(this.options.i18n.t("tui.status.interrupt_requested"));
      this.screen.render();
      return;
    }

    stream.interrupted = true;
    stream.controller.abort();
    this.pushActivity(
      "warn",
      this.options.i18n.t("tui.activity.interrupt_requested", {
        source,
        resend: queueResend ? this.options.i18n.t("tui.state.resend_queued") : this.options.i18n.t("tui.state.none")
      })
    );
    this.setStatus(
      queueResend
        ? this.options.i18n.t("tui.status.interrupting_resend")
        : this.options.i18n.t("tui.status.interrupting")
    );
    this.refreshHeader();
    this.screen.render();
  }

  private isActiveStream(id: number): boolean {
    return this.activeStream?.id === id;
  }

  private async resendLastPrompt(): Promise<void> {
    const session = this.getActiveSession();
    const pending =
      this.pendingInterruptedContext && this.pendingInterruptedContext.sessionId === session.id
        ? this.pendingInterruptedContext
        : undefined;
    if (pending) {
      this.pushActivity(
        "info",
        this.options.i18n.t("tui.activity.resending_prompt", {
          count: pending.originalQuestion.length
        })
      );
      this.addSystemLine(this.options.i18n.t("tui.system.resend"));
      this.setStatus(this.options.i18n.t("tui.status.resending"));
      await this.handleMessage("请从被打断处继续");
      return;
    }

    const prompt = this.lastInterruptedPrompt ?? this.lastUserPrompt;
    if (!prompt) {
      this.addSystemLine(this.options.i18n.t("tui.system.no_resend"));
      this.pushActivity("warn", this.options.i18n.t("tui.activity.resend_no_prompt"));
      this.setStatus(this.options.i18n.t("tui.status.no_prompt_resend"));
      return;
    }

    this.pushActivity("info", this.options.i18n.t("tui.activity.resending_prompt", { count: prompt.length }));
    this.addSystemLine(this.options.i18n.t("tui.system.resend"));
    this.setStatus(this.options.i18n.t("tui.status.resending"));
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
      this.addSystemLine(this.options.i18n.t("tui.system.busy"));
      this.pushActivity("warn", this.options.i18n.t("tui.activity.busy_ignored"));
      this.setStatus(this.options.i18n.t("tui.status.busy"));
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
          this.addSystemLine(this.options.i18n.t("tui.system.new_session", { title: session.title }));
          this.pushActivity("info", this.options.i18n.t("tui.activity.new_session_created", { title: session.title }));
          this.setStatus(this.options.i18n.t("tui.status.new_session_ready", { title: session.title }));
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
          this.pushActivity("info", this.options.i18n.t("tui.activity.help_shown"));
          this.addSystemLine(this.options.i18n.t("tui.system.help_shown"));
          break;
        case "seal":
          await this.options.runtime.agent.sealMemory();
          this.pushActivity("info", this.options.i18n.t("tui.activity.sealed"));
          this.addSystemLine(this.options.i18n.t("tui.system.sealed"));
          break;
        case "context": {
          const context = await this.options.runtime.agent.getContext(action.query);
          this.setInspector(this.options.i18n.t("tui.inspector.context_title"), context.formatted);
          this.pushActivity("info", this.options.i18n.t("tui.activity.context_loaded", { count: context.blocks.length }));
          this.addSystemLine(this.options.i18n.t("tui.system.context_loaded", { count: context.blocks.length }));
          break;
        }
        case "config": {
          const sanitized = this.options.sanitizeConfig(this.options.runtime.config);
          this.setInspector(this.options.i18n.t("tui.inspector.config_title"), JSON.stringify(sanitized, null, 2));
          this.pushActivity("info", this.options.i18n.t("tui.activity.config_loaded"));
          this.addSystemLine(this.options.i18n.t("tui.system.config_shown"));
          break;
        }
        case "trace": {
          const limit = Math.min(Math.max(action.limit ?? DEFAULT_TRACE_LIMIT, 1), MAX_TRACE_LIMIT);
          const entries = this.options.traceRecorder.list(limit);
          const payload = {
            total: this.options.traceRecorder.size(),
            entries
          };
          this.setInspector(this.options.i18n.t("tui.inspector.trace_title"), JSON.stringify(payload, null, 2));
          this.pushActivity("info", this.options.i18n.t("tui.activity.trace_loaded", { count: entries.length, total: payload.total }));
          this.addSystemLine(
            this.options.i18n.t("tui.system.trace_loaded", { count: entries.length, total: payload.total })
          );
          break;
        }
        case "traceClear":
          this.options.traceRecorder.clear();
          this.pushActivity("info", this.options.i18n.t("tui.activity.trace_cleared"));
          this.addSystemLine(this.options.i18n.t("tui.system.trace_cleared"));
          break;
        case "list": {
          const entries = await this.options.fileService.list(action.path, DEFAULT_LIST_LIMIT);
          this.setInspector(this.options.i18n.t("tui.inspector.files_title"), formatFileList(entries, action.path, this.options.i18n));
          this.pushActivity("info", this.options.i18n.t("tui.activity.files_listed", { path: action.path }));
          this.addSystemLine(this.options.i18n.t("tui.system.listed", { path: action.path }));
          break;
        }
        case "read": {
          const result = await this.options.fileService.read(action.path, DEFAULT_READ_MAX_BYTES);
          this.setInspector(this.options.i18n.t("tui.inspector.file_title"), formatFileRead(result, this.options.i18n));
          this.pushActivity("info", this.options.i18n.t("tui.activity.file_read", { path: action.path }));
          this.addSystemLine(this.options.i18n.t("tui.system.read", { path: action.path }));
          break;
        }

        case "invalid":
          this.pushActivity("warn", action.reason);
          this.addSystemLine(action.reason);
          break;
      }
      this.setStatus(this.options.i18n.t("tui.status.ready"));
    } catch (error) {
      const message = toErrorMessage(error);
      this.pushActivity("error", message);
      this.addSystemLine(this.options.i18n.t("tui.system.failed", { message }));
      this.setStatus(this.options.i18n.t("tui.status.error"));
    } finally {
      this.busy = false;
      this.refreshHeader();
      this.screen.render();
      this.focusInput();
    }
  }

  private async handleMessage(input: string, displayInput = input): Promise<void> {
    const session = this.getActiveSession();
    const pending =
      this.pendingInterruptedContext && this.pendingInterruptedContext.sessionId === session.id
        ? this.pendingInterruptedContext
        : undefined;
    const requestInput = pending
      ? composeInterruptResumePrompt(pending.originalQuestion, pending.partialText, input)
      : input;
    if (pending) {
      this.pendingInterruptedContext = undefined;
    }

    this.lastUserPrompt = input;
    this.addUserLine(displayInput);
    this.pushActivity("info", this.options.i18n.t("tui.activity.user_prompt", { count: displayInput.length }));

    if (this.streamEnabled) {
      this.setStatus(this.options.i18n.t("tui.status.streaming"));
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
          requestInput,
          (token) => {
            if (!this.isActiveStream(requestId)) return;
            if (stream.controller.signal.aborted || stream.interrupted) return;
            stream.partialText += token;
            this.updateConversation(assistantIndex, stream.partialText, true);
            this.setStatus(
              this.options.i18n.t("tui.status.streaming_chars", { count: stream.partialText.length })
            );
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
          this.pushActivity(
            "info",
            this.options.i18n.t("tui.activity.proactive_wakeup_stream", { count: response.proactiveText.length })
          );
        }
        this.lastInterruptedPrompt = undefined;
        this.pushActivity(
          "info",
          this.options.i18n.t("tui.activity.assistant_replied_stream", { count: response.text.length })
        );
        this.showPostResponseInspector(response.text, response.context.formatted);
        return;
      } catch (error) {
        const interrupted =
          stream.interrupted || stream.controller.signal.aborted || isAbortError(error);
        if (!interrupted) {
          throw error;
        }

        const interruptedText = formatInterruptedAssistantText(stream.partialText, this.options.i18n);
        this.updateConversation(assistantIndex, interruptedText, false);
        this.lastInterruptedPrompt = input;
        this.pendingInterruptedContext = {
          sessionId: stream.sessionId,
          originalQuestion: stream.userInput,
          partialText: stream.partialText,
          at: Date.now()
        };
        this.pushActivity("warn", this.options.i18n.t("tui.activity.response_interrupted"));
        this.setInspector(
          this.options.i18n.t("tui.inspector.interrupted_title"),
          this.options.i18n.t("tui.system.interrupted")
        );

        if (this.isActiveStream(requestId)) {
          this.activeStream = undefined;
        }
        this.refreshHeader();

        const shouldAutoResend = this.scheduleResendAfterInterrupt;
        this.scheduleResendAfterInterrupt = false;

        if (shouldAutoResend) {
          this.setStatus(this.options.i18n.t("tui.status.interrupted_resending"));
          this.screen.render();
          await this.handleMessage(input);
          return;
        }

        this.addSystemLine(this.options.i18n.t("tui.system.interrupted"));
        this.setStatus(this.options.i18n.t("tui.status.interrupted"));
        this.screen.render();
        return;
      } finally {
        if (this.isActiveStream(requestId)) {
          this.activeStream = undefined;
        }
      }
    }

    this.setStatus(this.options.i18n.t("tui.status.thinking"));
    const response = await this.options.runtime.agent.respond(requestInput);
    this.addAgentLine(response.text);
    if (response.proactiveText) {
      this.addAgentLine(response.proactiveText);
      this.pushActivity(
        "info",
        this.options.i18n.t("tui.activity.proactive_wakeup", { count: response.proactiveText.length })
      );
    }
    this.lastInterruptedPrompt = undefined;
    this.pushActivity("info", this.options.i18n.t("tui.activity.assistant_replied", { count: response.text.length }));
    this.showPostResponseInspector(response.text, response.context.formatted);
  }

  private showPostResponseInspector(responseText: string, formattedContext: string): void {
    if (this.showContextByDefault) {
      this.setInspector(this.options.i18n.t("tui.inspector.context_title"), formattedContext);
      return;
    }
    this.setInspector(this.options.i18n.t("tui.inspector.assistant_title"), responseText);
  }

  private refreshHeader(): void {
    const state = this.activeStream
      ? this.options.i18n.t("tui.header.state_stream")
      : this.busy
        ? this.options.i18n.t("tui.header.state_busy")
        : this.options.i18n.t("tui.header.state_ready");
    const stream = this.streamEnabled
      ? this.options.i18n.t("tui.header.stream_on")
      : this.options.i18n.t("tui.header.stream_off");
    const mode =
      this.mode === "code"
        ? this.options.i18n.t("tui.header.mode_code")
        : this.mode === "plan"
          ? this.options.i18n.t("tui.header.mode_plan")
          : this.options.i18n.t("tui.header.mode_chat");
    const activeSession = this.getActiveSession();
    const messages = `{gray-fg}${activeSession.timeline.length}{/gray-fg}`;
    const sessions = `{gray-fg}${this.sessions.length}{/gray-fg}`;
    this.header.setContent(
      this.options.i18n.t("tui.header.template", {
        state,
        mode,
        stream,
        sessions,
        messages
      })
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
      this.options.i18n.t("tui.palette.section_mode"),
      this.options.i18n.t("tui.palette.current_mode", { mode: this.mode }),
      "/mode chat|code|plan",
      "",
      this.options.i18n.t("tui.palette.section_session"),
      "/new (or /clear)",
      "/resend (or /retry)",
      "/stop",
      "/seal",
      "/ctx <query>",
      "/trace [n]",
      "/trace-clear",
      "",
      this.options.i18n.t("tui.palette.section_files"),
      "/ls [path]",
      "/cat <file>",
      "",
      this.options.i18n.t("tui.palette.section_hotkeys"),
      "Ctrl+1 " + this.options.i18n.t("tui.palette.hotkey_chat_mode"),
      "Ctrl+2 " + this.options.i18n.t("tui.palette.hotkey_code_mode"),
      "Ctrl+3 " + this.options.i18n.t("tui.palette.hotkey_plan_mode"),
      "Ctrl+K " + this.options.i18n.t("tui.palette.hotkey_quick_palette"),
      "Ctrl+N " + this.options.i18n.t("tui.palette.hotkey_new_session"),
      "Ctrl+R " + this.options.i18n.t("tui.palette.hotkey_resend"),
      "Ctrl+X " + this.options.i18n.t("tui.palette.hotkey_stop_streaming"),
      "Ctrl+S " + this.options.i18n.t("tui.palette.hotkey_seal"),
      "Ctrl+P " + this.options.i18n.t("tui.palette.hotkey_stream_toggle"),
      "Ctrl+T " + this.options.i18n.t("tui.palette.hotkey_trace"),
      "Ctrl+L " + this.options.i18n.t("tui.palette.hotkey_clear_session"),
      "Ctrl+E " + this.options.i18n.t("tui.palette.hotkey_external_editor"),
      this.options.i18n.t("tui.palette.hotkey_tab_cycle")
    ];
      this.setInspector(this.options.i18n.t("tui.palette.title"), lines.join("\n"));
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
      this.sessionList.setItems([this.options.i18n.t("tui.placeholder.no_sessions")]);
      this.sessionList.select(0);
      return;
    }

    const items = this.sessions.map((session, index) => {
      const activeMarker = index === this.activeSessionIndex ? "●" : " ";
      const updated = new Date(session.updatedAt).toLocaleTimeString();
      const count = session.timeline.length;
      return this.options.i18n.t("tui.session.list_item", {
        active: activeMarker,
        title: session.title,
        count,
        updated
      });
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
      this.conversation.setContent(`{light-black-fg}${this.options.i18n.t("tui.placeholder.empty_session")}{/light-black-fg}`);
      if (autoScroll) this.conversation.setScrollPerc(100);
      return;
    }

    const divider = "{light-black-fg}────────────────────────────────────────{/light-black-fg}";
    const content = session.timeline
      .map((entry) => formatConversationEntry(entry, this.options.i18n))
      .join(`\n${divider}\n`);
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
      this.activity.setContent(`{light-black-fg}${this.options.i18n.t("tui.placeholder.no_activity")}{/light-black-fg}`);
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
    this.setStatus(this.options.i18n.t("tui.status.exiting"));
    this.screen.render();
    this.screen.destroy();
    this.doneResolve?.();
  }
}

function formatConversationEntry(entry: ConversationEntry, i18n: I18n): string {
  const timestamp = new Date(entry.at).toLocaleTimeString();
  const role =
    entry.role === "user"
      ? `{gray-fg}[${i18n.t("tui.role.user")}]{/gray-fg}`
      : entry.role === "assistant"
        ? `{cyan-fg}[${i18n.t("tui.role.assistant")}]{/cyan-fg}`
        : `{light-black-fg}[${i18n.t("tui.role.system")}]{/light-black-fg}`;
  const body = blessed.escape(formatForDisplay(entry.text, i18n));
  const suffix = entry.streaming
    ? `\n{light-black-fg}▌ ${i18n.t("tui.status.streaming")}{/light-black-fg}`
    : "";
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

function formatForDisplay(content: string, i18n: I18n): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return i18n.t("tui.placeholder.empty_text");
  return normalized
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatInterruptedAssistantText(content: string, i18n: I18n): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return i18n.t("tui.placeholder.interrupted");
  }
  return `${trimmed}\n\n${i18n.t("tui.placeholder.interrupted_suffix")}`;
}

export function composeInterruptResumePrompt(
  previousQuestion: string,
  partialAssistantText: string,
  newQuestion: string
): string {
  const retainedPrefix = retainLeadingSentences(partialAssistantText);
  return [
    "你正在继续一次被打断的对话。",
    "[打断前用户问题]",
    previousQuestion.trim() || "(空)",
    "",
    "[已输出但被打断的前文（节选）]",
    retainedPrefix || "(无)",
    "",
    "[用户打断后新输入]",
    newQuestion.trim() || "(空)",
    "",
    "请遵循：优先延续原回答；若新输入要求转向，先衔接一句再转答；避免重复已输出内容。"
  ].join("\n");
}

export function retainLeadingSentences(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const compact = normalized.replace(/\n{2,}/g, "\n");
  const sentenceMatches = compact.match(/[^。！？!?\n]+(?:[。！？!?]|\n|$)/g) ?? [];
  const sentences = sentenceMatches
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .slice(0, INTERRUPT_RETAIN_SENTENCE_LIMIT);

  const fromSentences = sentences.join(" ").trim();
  const fallback = compact.slice(0, INTERRUPT_RETAIN_FALLBACK_CHARS).trim();
  const hasDelimiter = /[。！？!?\n]/.test(compact);
  const selected = !hasDelimiter && fromSentences.length > INTERRUPT_RETAIN_FALLBACK_CHARS
    ? fallback
    : fromSentences || fallback;
  if (!selected) return "";
  return selected.slice(0, INTERRUPT_RETAIN_MAX_CHARS).trim();
}

function formatFileList(entries: ReadonlyFileEntry[], pathInput: string, i18n: I18n): string {
  const header = i18n.t("tui.file_list.path", { path: pathInput });
  if (entries.length === 0) {
    return `${header}\n${i18n.t("tui.placeholder.empty_text")}`;
  }
  const lines = entries.map((entry) => {
    const prefix =
      entry.type === "dir"
        ? i18n.t("tui.file_list.type_dir")
        : entry.type === "file"
          ? i18n.t("tui.file_list.type_file")
          : i18n.t("tui.file_list.type_other");
    const sizePart = typeof entry.sizeBytes === "number" ? i18n.t("tui.file_list.size_bytes", { size: entry.sizeBytes }) : "";
    return `${prefix} ${entry.path}${sizePart}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

function formatFileRead(result: ReadFileResult, i18n: I18n): string {
  const meta = i18n.t("tui.file_read.meta", {
    path: result.path,
    bytes: result.bytes,
    totalBytes: result.totalBytes,
    truncated: result.truncated ? i18n.t("tui.file_read.truncated_suffix") : ""
  });
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
