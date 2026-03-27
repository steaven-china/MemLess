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
  constructor(private readonly context: Context) {}

  async addEvent(_event: MemoryEvent): Promise<void> {}
  async sealCurrentBlock(): Promise<void> {}
  createNewBlock(): void {}
  async retrieveBlocks(_query: string): Promise<BlockRef[]> {
    return this.context.blocks;
  }
  async getContext(_query: string): Promise<Context> {
    return this.context;
  }

  async tickProactiveWakeup(): Promise<void> {}
}

describe("Agent introduction injection", () => {
  test("injects Introduction when no memory blocks are available", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-intro-on-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "Introduction.md"), "INTRO_MARKER_TEXT", "utf8");

    const provider = new CaptureProvider();
    const memory = new MemoryManagerStub({
      blocks: [],
      recentEvents: [],
      formatted: "CTX_EMPTY"
    });
    const agent = new Agent(memory, provider, {
      workspaceRoot: folder,
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("INTRODUCTION (NO MEMORY BLOCKS AVAILABLE)");
    expect(systemMessage?.content).toContain("INTRO_MARKER_TEXT");
  });

  test("does not inject Introduction when memory blocks exist", async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), "mlex-intro-off-"));
    const docsDir = join(folder, "AgentDocs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(join(docsDir, "Introduction.md"), "INTRO_SHOULD_NOT_APPEAR", "utf8");

    const provider = new CaptureProvider();
    const memory = new MemoryManagerStub({
      blocks: [
        {
          id: "b1",
          score: 0.9,
          source: "fusion",
          summary: "summary",
          startTime: 1,
          endTime: 2,
          keywords: ["k1"]
        }
      ],
      recentEvents: [],
      formatted: "CTX_HAS_BLOCKS"
    });
    const agent = new Agent(memory, provider, {
      workspaceRoot: folder,
      includeAgentsMd: false
    });

    await agent.respond("hello");
    const systemMessage = provider.lastMessages.find((message) => message.role === "system");
    expect(systemMessage?.content).not.toContain("INTRODUCTION (NO MEMORY BLOCKS AVAILABLE)");
    expect(systemMessage?.content).not.toContain("INTRO_SHOULD_NOT_APPEAR");
  });
});
