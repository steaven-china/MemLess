import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type {
  AgentToolCall,
  AgentToolResult,
  IAgentToolExecutor
} from "../src/agent/AgentToolExecutor.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";

class ToolFlowProvider implements ILLMProvider {
  public rounds = 0;
  public seen: ChatMessage[][] = [];

  async generate(messages: ChatMessage[]): Promise<string> {
    this.rounds += 1;
    this.seen.push(messages.map((message) => ({ ...message })));
    if (this.rounds === 1) {
      return `<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>`;
    }
    return "工具结果已收到，继续回答。";
  }
}

class EndlessToolProvider implements ILLMProvider {
  async generate(): Promise<string> {
    return '<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>';
  }
}

class MockToolExecutor implements IAgentToolExecutor {
  public calls: AgentToolCall[] = [];

  instructions(): string {
    return "mock tools";
  }

  async execute(call: AgentToolCall): Promise<AgentToolResult> {
    this.calls.push(call);
    return {
      ok: true,
      content: "{\"entries\":[{\"path\":\"README.md\",\"type\":\"file\"}]}"
    };
  }
}

class StreamTrackingProvider implements ILLMProvider {
  public generateCalls = 0;
  public streamCalls = 0;

  async generate(messages: ChatMessage[]): Promise<string> {
    this.generateCalls += 1;
    const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    if (lastUser.includes("TOOL_RESULT")) {
      return "工具流程完成";
    }
    return '<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>';
  }

  async generateStream(_messages: ChatMessage[], onToken: (token: string) => void): Promise<string> {
    this.streamCalls += 1;
    onToken("stream");
    return "stream";
  }
}

class JsonWithNameProvider implements ILLMProvider {
  async generate(): Promise<string> {
    return '这是普通说明文本，包含 JSON 片段：{"name":"demo"}';
  }
}



describe("Agent tool orchestration", () => {
  test("executes tool calls requested by model", async () => {
    const runtime = createRuntime();
    const provider = new ToolFlowProvider();
    const toolExecutor = new MockToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const response = await agent.respond("列一下当前目录文件");

    expect(response.text).toContain("工具结果已收到");
    expect(provider.rounds).toBe(2);
    expect(toolExecutor.calls).toHaveLength(1);
    expect(toolExecutor.calls[0]?.name).toBe("readonly.list");

    const secondRound = provider.seen[1] ?? [];
    const lastUserMessage = [...secondRound].reverse().find((message) => message.role === "user");
    expect(lastUserMessage?.content).toContain("TOOL_RESULT");
  });

  test("keeps tool mode on generate path even when provider supports streaming", async () => {
    const runtime = createRuntime();
    const provider = new StreamTrackingProvider();
    const toolExecutor = new MockToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });
    const chunks: string[] = [];

    const response = await agent.respondStream("请调用工具", (token) => {
      chunks.push(token);
    });

    expect(response.text).toBe("工具流程完成");
    expect(chunks.join("")).toBe("工具流程完成");
    expect(provider.streamCalls).toBe(0);
    expect(provider.generateCalls).toBe(2);
    expect(toolExecutor.calls).toHaveLength(1);
  });

  test("does not treat plain text with name-like json snippet as tool payload", async () => {
    const runtime = createRuntime();
    const provider = new JsonWithNameProvider();
    const toolExecutor = new MockToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const response = await agent.respond("普通回答");

    expect(response.text).toContain("JSON 片段");
    expect(toolExecutor.calls).toHaveLength(0);
  });

  test("returns fallback when tool-call rounds exceed limit", async () => {
    const runtime = createRuntime();
    const provider = new EndlessToolProvider();
    const toolExecutor = new MockToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const response = await agent.respond("持续调用工具");

    expect(response.text).toContain("Tool call rounds exceeded limit");
    expect(toolExecutor.calls).toHaveLength(6);
  });
});
