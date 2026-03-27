import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("Proactive seal", () => {
  test("auto seals at user->assistant turn boundary", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 9999,
        minTokensPerBlock: 1,
        proactiveSealEnabled: true,
        proactiveSealTurnBoundary: true,
        proactiveSealMinTokens: 1,
        proactiveSealIdleSeconds: 99999
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "第一轮：提出问题",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "第一轮：给出回答",
      timestamp: now + 1
    });

    const blockStore = runtime.container.resolve<{
      list: () => Promise<Array<{ id: string }>>;
    }>("blockStore");
    const blocks = await blockStore.list();
    expect(blocks.length).toBe(1);
  });

  test("seals at consecutive role-switch boundaries", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 9999,
        minTokensPerBlock: 1,
        proactiveSealEnabled: true,
        proactiveSealTurnBoundary: true,
        proactiveSealMinTokens: 1,
        proactiveSealIdleSeconds: 99999
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "第一轮：提出问题",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "第一轮：给出回答",
      timestamp: now + 1
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "第二轮：继续追问",
      timestamp: now + 2
    });

    const blockStore = runtime.container.resolve<{
      list: () => Promise<Array<{ id: string }>>;
    }>("blockStore");
    const blocks = await blockStore.list();
    expect(blocks.length).toBe(2);
  });

  test("auto seals when idle gap exceeds threshold", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 9999,
        minTokensPerBlock: 1,
        proactiveSealEnabled: true,
        proactiveSealTurnBoundary: false,
        proactiveSealMinTokens: 1,
        proactiveSealIdleSeconds: 60
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "会话开始",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "继续处理",
      timestamp: now + 1_000
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "长时间后新进展",
      timestamp: now + 70_000
    });

    const blockStore = runtime.container.resolve<{
      list: () => Promise<Array<{ id: string }>>;
    }>("blockStore");
    const blocks = await blockStore.list();
    expect(blocks.length).toBe(1);
  });

  test("does not seal at role-switch boundary when below minTokensPerBlock", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 9999,
        minTokensPerBlock: 120,
        proactiveSealEnabled: true,
        proactiveSealTurnBoundary: true,
        proactiveSealMinTokens: 1,
        proactiveSealIdleSeconds: 99999
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "短问题",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "短回答",
      timestamp: now + 1
    });

    const blockStore = runtime.container.resolve<{
      list: () => Promise<Array<{ id: string }>>;
    }>("blockStore");
    const blocks = await blockStore.list();
    expect(blocks.length).toBe(0);
  });
});
