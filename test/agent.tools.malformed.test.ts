import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { IAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import { createRuntime } from "../src/container.js";

class MalformedThenValidProvider implements ILLMProvider {
  private round = 0;

  constructor(private readonly malformedPayload: string) {}

  async generate(messages: ChatMessage[]): Promise<string> {
    this.round += 1;
    if (this.round === 1) {
      return this.malformedPayload;
    }
    if (this.round === 2) {
      const lastUser = [...messages].reverse().find((message) => message.role === "user");
      if (!(lastUser?.content ?? "").includes("Invalid tool-call payload")) {
        throw new Error("parser feedback message missing");
      }
      return '<tool_call>{"name":"readonly.list","args":{"path":"."}}</tool_call>';
    }
    return "done";
  }
}

class CountingToolExecutor implements IAgentToolExecutor {
  public callCount = 0;

  instructions(): string {
    return "mock tools";
  }

  async execute(): Promise<{ ok: boolean; content: string }> {
    this.callCount += 1;
    return { ok: true, content: "{}" };
  }
}

describe("Agent tool parsing resilience", () => {
  test("retries when tagged tool_call payload is malformed", async () => {
    const runtime = createRuntime();
    const provider = new MalformedThenValidProvider("<tool_call>{not json}</tool_call>");
    const toolExecutor = new CountingToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const result = await agent.respond("list files");
    expect(result.text).toBe("done");
    expect(toolExecutor.callCount).toBe(1);
  });

  test("retries when fenced json payload is malformed", async () => {
    const runtime = createRuntime();
    const provider = new MalformedThenValidProvider("```json\n{\"name\":}\n```");
    const toolExecutor = new CountingToolExecutor();
    const agent = new Agent(runtime.memoryManager, provider, { toolExecutor });

    const result = await agent.respond("list files");
    expect(result.text).toBe("done");
    expect(toolExecutor.callCount).toBe(1);
  });
});
