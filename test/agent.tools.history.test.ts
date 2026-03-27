import { describe, expect, test } from "vitest";

import { BuiltinAgentToolExecutor } from "../src/agent/AgentToolExecutor.js";
import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("BuiltinAgentToolExecutor history.query", () => {
  test("returns queried conversation records with query meta", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 120,
        minTokensPerBlock: 40
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付 webhook 重试导致重复扣费，需要排查幂等键。",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "建议先看幂等键和重试队列。",
      timestamp: now + 1
    });
    await runtime.memoryManager.sealCurrentBlock();

    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: runtime.memoryManager
    });
    const result = await tool.execute({
      name: "history.query",
      args: {
        query: "支付 webhook 幂等",
        mode: "semantic",
        topBlocks: 3,
        includeRaw: true,
        includeRecent: true,
        includePrediction: true,
        keywords: ["重试", "去重"]
      }
    });

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content) as {
      blockCount?: number;
      blocks?: Array<{ id?: string; rawEvents?: unknown[] }>;
      recentEvents?: unknown[];
      prediction?: unknown;
      queryMeta?: {
        mode?: string;
        topBlocks?: number;
        includePrediction?: boolean;
        keywords?: string[];
        effectiveQuery?: string;
      };
    };
    expect((payload.blockCount ?? 0)).toBeGreaterThan(0);
    expect((payload.blocks?.length ?? 0)).toBeGreaterThan(0);
    expect(Array.isArray(payload.blocks?.[0]?.rawEvents)).toBe(true);
    expect(Array.isArray(payload.recentEvents)).toBe(true);
    expect(payload.queryMeta?.mode).toBe("semantic");
    expect(payload.queryMeta?.topBlocks).toBe(3);
    expect(payload.queryMeta?.includePrediction).toBe(true);
    expect(payload.queryMeta?.keywords).toEqual(["重试", "去重"]);
    expect(payload.queryMeta?.effectiveQuery).toContain("支付 webhook 幂等");
    expect(payload.queryMeta?.effectiveQuery).toContain("重试");
  });

  test("supports limit alias and truncation flag", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 120,
        minTokensPerBlock: 40
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "这是用于制造较长上下文的一段文本。".repeat(30),
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    const tool = new BuiltinAgentToolExecutor({
      workspaceRoot: process.cwd(),
      memoryManager: runtime.memoryManager
    });
    const result = await tool.execute({
      name: "history.query",
      args: {
        query: "长上下文",
        limit: 1,
        includePrediction: false,
        maxFormattedChars: 256
      }
    });

    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.content) as {
      blocks?: unknown[];
      truncated?: boolean;
      prediction?: unknown;
      queryMeta?: { topBlocks?: number; includePrediction?: boolean };
    };
    expect(payload.blocks?.length ?? 0).toBeLessThanOrEqual(1);
    expect(payload.queryMeta?.topBlocks).toBe(1);
    expect(payload.queryMeta?.includePrediction).toBe(false);
    expect(payload.truncated).toBe(true);
    expect(payload.prediction).toBeNull();
  });
});
