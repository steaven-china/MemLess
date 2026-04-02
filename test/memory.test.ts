import { describe, expect, test } from "vitest";

import { createRuntime } from "../src/container.js";
import { createId } from "../src/utils/id.js";

describe("PartitionMemoryManager", () => {
  test("seals blocks and retrieves semantic context", async () => {
    const runtime = createRuntime({
      manager: {
        maxTokensPerBlock: 60,
        minTokensPerBlock: 20,
        semanticTopK: 5,
        finalTopK: 5
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "我们在支付模块遇到了订单状态不一致的问题，需要排查 webhook 重试。",
      timestamp: now
    });
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "建议先检查幂等键是否生效，以及重试队列是否重复消费。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "最终修复是在 webhook handler 增加幂等锁，并修复了延迟任务配置。",
      timestamp: now + 20
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const context = await runtime.memoryManager.getContext("支付 webhook 幂等 问题");
    expect(context.blocks.length).toBeGreaterThan(0);
    expect(context.formatted).toContain("RETRIEVED BLOCKS");
  });

  test("keeps recentEvents across sealed blocks", async () => {
    const runtime = createRuntime({
      manager: {
        recentEventWindow: 3,
        maxTokensPerBlock: 9999,
        proactiveSealEnabled: false
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "第一条",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "第二条",
      timestamp: now + 1
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "第三条",
      timestamp: now + 2
    });

    const context = await runtime.memoryManager.getContext("第三条");
    expect(context.recentEvents.map((event) => event.text)).toEqual(["第一条", "第二条", "第三条"]);
    expect(context.proactiveSignal?.timerEnabled).toBe(false);
    expect(context.proactiveSignal?.triggerSource).toBe("user");
  });

  test("marks proactive signal triggerSource as timer on timer tick", async () => {
    const runtime = createRuntime({
      manager: {
        proactiveWakeupEnabled: true,
        predictionEnabled: true,
        proactiveTimerEnabled: true,
        proactiveTimerIntervalSeconds: 15
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付重试问题",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.tickProactiveWakeup();
    const context = await runtime.memoryManager.getContext("继续", "timer");

    expect(context.proactiveSignal?.triggerSource).toBe("timer");
    expect(context.proactiveSignal?.timerEnabled).toBe(true);
    expect(context.proactiveSignal?.timerIntervalSeconds).toBe(15);
  });

  test("appends in-chunk neighbor blocks without changing top retrieval order", async () => {
    const runtime = createRuntime({
      manager: {
        semanticTopK: 3,
        finalTopK: 1,
        chunkManifestEnabled: true,
        chunkAffectsRetrieval: false,
        chunkManifestTargetTokens: 500,
        chunkManifestMaxTokens: 1000,
        chunkManifestMaxBlocks: 8,
        chunkManifestMaxGapMs: 60_000,
        chunkNeighborExpandEnabled: true,
        chunkNeighborWindow: 1,
        chunkNeighborScoreGate: 0,
        chunkMaxExpandedBlocks: 2
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "项目A接口超时，网关重试策略和降级方案需要补充。",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "支付 webhook 幂等锁修复完成，重复回调不会再二次入账。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "部署脚本与回滚步骤已确认，发布窗口安排在今晚。",
      timestamp: now + 20
    });
    await runtime.memoryManager.sealCurrentBlock();

    const context = await runtime.memoryManager.getContext("支付 webhook 幂等");
    expect(context.blocks.length).toBeGreaterThan(1);
    expect(context.blocks[0]?.summary).toContain("支付 webhook");
  });

  test("collects structured proactive diagnostics", async () => {
    const runtime = createRuntime({
      manager: {
        proactiveWakeupEnabled: true,
        predictionEnabled: true
      },
      component: {
        chunkStrategy: "fixed"
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "请继续支付重试的排查",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.getContext("继续");

    const diagnostics = runtime.memoryManager.getProactiveSignalDiagnostics();
    expect(diagnostics.latest === null || typeof diagnostics.latest.reason === "string").toBe(true);
    expect(Array.isArray(diagnostics.recent)).toBe(true);
    expect(diagnostics.recent.length).toBeGreaterThan(0);
    expect(Array.isArray(diagnostics.nonTriggerReasons)).toBe(true);
  });

  test("supports relation graph traversal for directional query", async () => {
    const runtime = createRuntime({
      manager: {
        relationDepth: 1,
        graphExpansionTopK: 3
      }
    });

    const now = Date.now();
    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "user",
      text: "任务A：先完成需求分析并拆分子任务。",
      timestamp: now
    });
    await runtime.memoryManager.sealCurrentBlock();

    await runtime.memoryManager.addEvent({
      id: createId("event"),
      role: "assistant",
      text: "任务B：根据分析结果开始编码实现。",
      timestamp: now + 10
    });
    await runtime.memoryManager.sealCurrentBlock();
    await runtime.memoryManager.flushAsyncRelations();

    const context = await runtime.memoryManager.getContext("下一步是什么");
    expect(context.blocks.length).toBeGreaterThan(0);
  });
});
