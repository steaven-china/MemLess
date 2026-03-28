import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Context, MemoryEvent } from "../types.js";
import type { I18n } from "../i18n/index.js";
import { createId } from "../utils/id.js";
import type { IMemoryManager } from "../memory/IMemoryManager.js";
import { ProactiveDialoguePlanner } from "../proactive/ProactiveDialoguePlanner.js";
import { ProactiveActuator } from "../proactive/ProactiveActuator.js";
import type { IDebugTraceRecorder } from "../debug/DebugTraceRecorder.js";
import {
  formatToolResult,
  parseToolCall,
  type IAgentToolExecutor
} from "./AgentToolExecutor.js";
import type {
  ChatMessage,
  ILLMProvider,
  LlmGenerateOptions,
  TokenCallback
} from "./LLMProvider.js";

export interface AgentResponse {
  text: string;
  context: Context;
  proactiveText?: string;
}

export interface AgentOptions {
  systemPrompt?: string;
  includeAgentsMd?: boolean;
  agentsMdPath?: string;
  workspaceRoot?: string;
  includeIntroductionWhenNoMemory?: boolean;
  introductionPath?: string;
  toolExecutor?: IAgentToolExecutor;
  traceRecorder?: IDebugTraceRecorder;
  proactivePlanner?: ProactiveDialoguePlanner;
  proactiveActuator?: ProactiveActuator;
  i18n?: I18n;
}

export interface AgentGenerateOptions {
  signal?: AbortSignal;
}

export class Agent {
  private static readonly MAX_TOOL_ROUNDS = 6;
  private readonly systemPrompt: string;
  private readonly toolExecutor?: IAgentToolExecutor;
  private readonly introduction?: string;
  private readonly includeIntroductionWhenNoMemory: boolean;
  private readonly traceRecorder?: IDebugTraceRecorder;
  private readonly proactivePlanner?: ProactiveDialoguePlanner;
  private readonly proactiveActuator?: ProactiveActuator;
  private readonly i18n?: I18n;
  private proactiveTickRunning = false;

  constructor(
    private readonly memoryManager: IMemoryManager,
    private readonly provider: ILLMProvider,
    options: AgentOptions = {}
  ) {
    const basePrompt =
      options.systemPrompt ??
      options.i18n?.t("agent.system.default") ??
      "You are a practical AI assistant. Use provided memory context as high-priority factual grounding.";
    const agentsGuidelines =
      options.includeAgentsMd === false
        ? undefined
        : loadAgentsGuidelines(options.agentsMdPath, options.workspaceRoot);
    this.introduction = loadIntroduction(options.introductionPath, options.workspaceRoot);
    this.includeIntroductionWhenNoMemory = options.includeIntroductionWhenNoMemory !== false;
    this.toolExecutor = options.toolExecutor;
    this.traceRecorder = options.traceRecorder;
    this.proactivePlanner = options.proactivePlanner;
    this.proactiveActuator = options.proactiveActuator;
    this.i18n = options.i18n;
    const toolGuidelines = this.toolExecutor?.instructions();

    const parts = [basePrompt];
    if (agentsGuidelines) {
      parts.push(`${this.i18n?.t("agent.section.guidelines") ?? "=== WORKSPACE AGENTS GUIDELINES ==="}\n${agentsGuidelines}`);
    }
    if (toolGuidelines) {
      parts.push(`${this.i18n?.t("agent.section.tool_protocol") ?? "=== TOOL USE PROTOCOL ==="}\n${toolGuidelines}`);
    }
    this.systemPrompt = parts.join("\n\n");
  }

  async respond(input: string, options: AgentGenerateOptions = {}): Promise<AgentResponse> {
    this.trace("respond.start", { stream: false, input });
    const userEvent = this.createEvent("user", input);
    await this.memoryManager.addEvent(userEvent);

    const context = await this.memoryManager.getContext(input);
    this.trace("context.ready", {
      stream: false,
      blockCount: context.blocks.length,
      recentEventCount: context.recentEvents.length,
      formattedLength: context.formatted.length
    });
    const baseMessages = this.composeMessages(input, context);
    const text = await this.generateWithTools(baseMessages, undefined, options);

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    const proactiveText = await this.maybeProactiveWakeup(input, context);
    this.trace("respond.done", {
      stream: false,
      text,
      proactiveText
    });

    return { text, context, proactiveText };
  }

  async respondStream(
    input: string,
    onToken: TokenCallback,
    options: AgentGenerateOptions = {}
  ): Promise<AgentResponse> {
    this.trace("respond.start", { stream: true, input });
    const userEvent = this.createEvent("user", input);
    await this.memoryManager.addEvent(userEvent);

    const context = await this.memoryManager.getContext(input);
    this.trace("context.ready", {
      stream: true,
      blockCount: context.blocks.length,
      recentEventCount: context.recentEvents.length,
      formattedLength: context.formatted.length
    });
    const baseMessages = this.composeMessages(input, context);
    const text = await this.generateWithTools(baseMessages, onToken, options);

    const assistantEvent = this.createEvent("assistant", text);
    await this.memoryManager.addEvent(assistantEvent);
    const proactiveText = await this.maybeProactiveWakeup(input, context);
    this.trace("respond.done", {
      stream: true,
      text,
      proactiveText
    });

    return { text, context, proactiveText };
  }

  async sealMemory(): Promise<void> {
    await this.memoryManager.sealCurrentBlock();
  }

  async getContext(query: string, triggerSource: "user" | "timer" = "user"): Promise<Context> {
    return this.memoryManager.getContext(query, triggerSource);
  }

  async tickProactiveWakeup(): Promise<string | undefined> {
    if (!this.proactivePlanner || !this.proactiveActuator) return undefined;
    if (this.proactiveTickRunning) return undefined;
    this.proactiveTickRunning = true;
    try {
      await this.memoryManager.tickProactiveWakeup();
      const context = await this.memoryManager.getContext(
        this.i18n?.t("agent.timer.wakeup_query") ?? "continue current task",
        "timer"
      );
      const proactiveText = await this.maybeProactiveWakeup(
        this.i18n?.t("agent.timer.wakeup_query") ?? "continue current task",
        context
      );
      this.trace("proactive.timer.tick", {
        proactiveText
      });
      return proactiveText;
    } finally {
      this.proactiveTickRunning = false;
    }
  }

  private composeMessages(input: string, context: Context): ChatMessage[] {
    const systemParts = [this.systemPrompt];
    if (this.shouldInjectIntroduction(context)) {
      systemParts.push(
        `${this.i18n?.t("agent.introduction.title") ?? "=== INTRODUCTION (NO MEMORY BLOCKS AVAILABLE) ==="}\n${this.introduction}`
      );
    }
    systemParts.push(context.formatted);

    return [
      {
        role: "system",
        content: systemParts.join("\n\n")
      },
      {
        role: "user",
        content: input
      }
    ];
  }

  private createEvent(role: MemoryEvent["role"], text: string): MemoryEvent {
    return {
      id: createId("event"),
      role,
      text,
      timestamp: Date.now()
    };
  }

  private async generateFallbackStream(
    messages: ChatMessage[],
    onToken: TokenCallback,
    options: LlmGenerateOptions
  ): Promise<string> {
    const text = await this.provider.generate(messages, options);
    onToken(text);
    return text;
  }

  private async generateWithTools(
    baseMessages: ChatMessage[],
    onToken?: TokenCallback,
    options: LlmGenerateOptions = {}
  ): Promise<string> {
    this.trace("model.round.start", {
      toolMode: Boolean(this.toolExecutor),
      stream: Boolean(onToken)
    });
    if (!this.toolExecutor) {
      if (onToken && this.provider.generateStream) {
        return this.provider.generateStream(baseMessages, onToken, options);
      }
      if (onToken) {
        return this.generateFallbackStream(baseMessages, onToken, options);
      }
      return this.provider.generate(baseMessages, options);
    }

    const messages: ChatMessage[] = [...baseMessages];
    for (let round = 0; round < Agent.MAX_TOOL_ROUNDS; round += 1) {
      const candidate = await this.provider.generate(messages, options);
      this.trace("model.round.candidate", {
        round,
        candidate
      });
      const call = parseToolCall(candidate);
      if (!call) {
        const trimmedCandidate = candidate.trim();
        const looksLikeJsonToolPayload =
          trimmedCandidate.startsWith("{") ||
          trimmedCandidate.startsWith("```") ||
          trimmedCandidate.startsWith("```json");
        const looksLikeToolPayload =
          candidate.includes("<tool_call>") ||
          (looksLikeJsonToolPayload &&
            (candidate.includes('"tool":') ||
              candidate.includes('"name":') ||
              candidate.includes('"function":')));
        if (looksLikeToolPayload) {
          this.trace("tool.parse.invalid", {
            round,
            candidate
          });
          messages.push({ role: "assistant", content: candidate });
          messages.push({
            role: "user",
            content:
              this.i18n?.t("agent.tool.parse.invalid") ??
              'TOOL_RESULT {"tool":"tool_call.parser","ok":false,"content":"Invalid tool-call payload. Please return strict JSON with name and args (or tool/arguments)."}'
          });
          continue;
        }
        this.trace("model.round.final", {
          round,
          candidate
        });
        if (onToken) onToken(candidate);
        return candidate;
      }

      this.trace("tool.parse.ok", {
        round,
        call
      });
      const result = await this.toolExecutor.execute(call);
      this.trace("tool.execute.done", {
        round,
        call,
        result
      });
      messages.push({ role: "assistant", content: candidate });
      messages.push({ role: "user", content: formatToolResult(call, result) });
    }

    const fallback =
      this.i18n?.t("agent.tool.round.limit", { limit: Agent.MAX_TOOL_ROUNDS }) ??
      `Tool call rounds exceeded limit (${Agent.MAX_TOOL_ROUNDS}). Please provide a concise best-effort answer with available information.`;
    this.trace("tool.round.limit", {
      maxToolRounds: Agent.MAX_TOOL_ROUNDS,
      fallback
    });
    if (onToken) onToken(fallback);
    return fallback;
  }

  private async maybeProactiveWakeup(input: string, context: Context): Promise<string | undefined> {
    if (!this.proactivePlanner || !this.proactiveActuator) return undefined;
    const plan = this.proactivePlanner.buildPlan({ userInput: input, context });
    if (plan.action === "noop") return undefined;
    const proactiveText = await this.proactiveActuator.execute(plan);
    if (!proactiveText) return undefined;
    this.trace("proactive.wakeup", {
      action: plan.action,
      reason: plan.reason,
      proactiveText
    });
    return proactiveText;
  }

  private shouldInjectIntroduction(context: Context): boolean {
    if (!this.includeIntroductionWhenNoMemory) return false;
    if (!this.introduction) return false;
    return context.blocks.length === 0;
  }

  private trace(event: string, payload: unknown): void {
    this.traceRecorder?.record("agent", event, payload);
  }
}

function loadAgentsGuidelines(customPath?: string, workspaceRoot?: string): string | undefined {
  const root = resolve(workspaceRoot ?? process.cwd());
  const candidates = new Set<string>();
  if (customPath) {
    candidates.add(resolve(customPath));
  }
  candidates.add(resolve(root, "AgentDocs", "AGENT.md"));
  candidates.add(resolve(root, "AgentDocs", "AGENTS.md"));

  let current = root;
  while (true) {
    candidates.add(resolve(current, "AGENTS.md"));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return readFirstNonEmpty(candidates, 4000);
}

function loadIntroduction(customPath?: string, workspaceRoot?: string): string | undefined {
  const root = resolve(workspaceRoot ?? process.cwd());
  const candidates = new Set<string>();
  if (customPath) {
    candidates.add(resolve(customPath));
  }
  candidates.add(resolve(root, "AgentDocs", "Introduction.md"));
  candidates.add(resolve(root, "Introduction.md"));

  return readFirstNonEmpty(candidates, 6000);
}

function readFirstNonEmpty(paths: Iterable<string>, maxLength: number): string | undefined {
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8").trim();
    if (!content) continue;
    return content.length <= maxLength ? content : `${content.slice(0, maxLength)}\n...[truncated]`;
  }

  return undefined;
}






