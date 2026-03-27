import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { Agent } from "../src/agent/Agent.js";
import type { ChatMessage, ILLMProvider } from "../src/agent/LLMProvider.js";
import type { IMemoryManager } from "../src/memory/IMemoryManager.js";
import type { BlockRef, Context, MemoryEvent } from "../src/types.js";

class CaptureProvider implements ILLMProvider {
  public lastMessages: ChatMessage[] = [];

  async generate(messages: ChatMessage[]): Promise<string> {
    this.lastMessages = messages;
    return "ok";
  }
}

class MemoryManagerStub implements IMemoryManager {
  async addEvent(_event: MemoryEvent): Promise<void> {}
  async sealCurrentBlock(): Promise<void> {}
  createNewBlock(): void {}
  async retrieveBlocks(_query: string): Promise<BlockRef[]> {
    return [];
  }
  async getContext(_query: string): Promise<Context> {
    return {
      blocks: [],
      recentEvents: [],
      formatted: "CTX"
    };
  }

  async tickProactiveWakeup(): Promise<void> {}
}

describe("Agent AGENT.md injection", () => {
  test("injects AgentDocs/AGENT.md into system prompt by default", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-agents-md-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "AGENT.md"), "INJECT_MARKER_AGENTDOCS", "utf8");
    await fs.writeFile(join(folder, "AGENTS.md"), "LEGACY_SHOULD_NOT_WIN", "utf8");

    const provider = new CaptureProvider();
    const agent = new Agent(new MemoryManagerStub(), provider, {
      workspaceRoot: folder
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("WORKSPACE AGENTS GUIDELINES");
    expect(systemMessage?.content).toContain("INJECT_MARKER_AGENTDOCS");
    expect(systemMessage?.content).not.toContain("LEGACY_SHOULD_NOT_WIN");
  });

  test("supports disabling AGENT.md injection", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-agents-md-off-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    const agentPath = join(docsDir, "AGENT.md");
    await fs.writeFile(agentPath, "DISABLE_INJECT_MARKER", "utf8");

    const provider = new CaptureProvider();
    const agent = new Agent(new MemoryManagerStub(), provider, {
      workspaceRoot: folder,
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).not.toContain("DISABLE_INJECT_MARKER");
    expect(systemMessage?.content).not.toContain("WORKSPACE AGENTS GUIDELINES");
  });
});
