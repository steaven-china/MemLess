import { describe, expect, test } from "vitest";

import { ProactiveDialoguePlanner } from "../src/proactive/ProactiveDialoguePlanner.js";
import type { BlockRef, Context, ProactiveSignal } from "../src/types.js";

function makeSignal(override: Partial<ProactiveSignal> = {}): ProactiveSignal {
  return {
    allowWakeup: true,
    mode: "inject",
    reason: "low_entropy_soft",
    evidenceNeedHint: "search_required",
    triggerSource: "user",
    timerEnabled: false,
    timerIntervalSeconds: 0,
    intents: [{ blockId: "b1", label: "task A", confidence: 0.9 }],
    ...override
  };
}

function makeBlock(id: string, summary: string, keywords: string[]): BlockRef {
  return {
    id,
    score: 0.9,
    source: "vector",
    summary,
    startTime: 0,
    endTime: 0,
    keywords
  };
}

function makeContext(blocks: BlockRef[] = [], signal?: ProactiveSignal): Context {
  return { blocks, recentEvents: [], formatted: "", proactiveSignal: signal };
}

function makePlanner(maxSearchQueries?: number) {
  return new ProactiveDialoguePlanner({
    proactiveWakeupRequireEvidence: true,
    proactiveWakeupMinIntervalSeconds: 0,
    proactiveWakeupMaxPerHour: 100,
    maxSearchQueries
  });
}

describe("generateSearchQueries", () => {
  test("returns [userInput] when no context blocks", () => {
    const planner = makePlanner();
    const plan = planner.buildPlan({
      userInput: "deploy pipeline",
      context: makeContext([], makeSignal())
    });
    expect(plan.searchQueries[0]).toBe("deploy pipeline");
    expect(plan.searchQueries.length).toBeGreaterThanOrEqual(1);
  });

  test("userInput is always first", () => {
    const blocks = [
      makeBlock("b1", "API 设计与接口规范文档", ["api", "interface"]),
      makeBlock("b2", "数据库迁移步骤说明", ["database", "migration"])
    ];
    const planner = makePlanner();
    const plan = planner.buildPlan({
      userInput: "如何部署",
      context: makeContext(blocks, makeSignal())
    });
    expect(plan.searchQueries[0]).toBe("如何部署");
  });

  test("includes block summary excerpt as additional candidate", () => {
    const blocks = [makeBlock("b1", "完整的前端构建流程与依赖管理", ["构建", "前端", "依赖"])];
    const planner = makePlanner(3);
    const plan = planner.buildPlan({
      userInput: "后端优化",
      context: makeContext(blocks, makeSignal())
    });
    // Should have at least 2 queries (userInput + summary or keywords)
    expect(plan.searchQueries.length).toBeGreaterThanOrEqual(2);
    expect(plan.searchQueries[0]).toBe("后端优化");
  });

  test("maxSearchQueries=1 truncates to single query", () => {
    const blocks = [
      makeBlock("b1", "测试流程自动化方案", ["自动化", "测试"]),
      makeBlock("b2", "代码审查规范指南", ["review", "code"])
    ];
    const planner = makePlanner(1);
    const plan = planner.buildPlan({
      userInput: "质量保证",
      context: makeContext(blocks, makeSignal())
    });
    expect(plan.searchQueries).toHaveLength(1);
    expect(plan.searchQueries[0]).toBe("质量保证");
  });

  test("deduplicates identical candidates", () => {
    const sameText = "deploy pipeline";
    const blocks = [makeBlock("b1", sameText, [sameText])];
    const planner = makePlanner(5);
    const plan = planner.buildPlan({
      userInput: sameText,
      context: makeContext(blocks, makeSignal())
    });
    // All candidates collapsed to 1 since summary == keyword == userInput
    const unique = new Set(plan.searchQueries);
    expect(unique.size).toBe(plan.searchQueries.length);
  });

  test("respects maxSearchQueries=3 upper bound", () => {
    const blocks = [
      makeBlock("b1", "微服务架构设计文档", ["微服务", "架构", "设计", "文档"]),
      makeBlock("b2", "容器化部署流程", ["docker", "k8s"]),
      makeBlock("b3", "监控告警系统配置", ["prometheus", "alerting"])
    ];
    const planner = makePlanner(3);
    const plan = planner.buildPlan({
      userInput: "服务治理",
      context: makeContext(blocks, makeSignal())
    });
    expect(plan.searchQueries.length).toBeLessThanOrEqual(3);
  });

  test("returns empty searchQueries when shouldSearchEvidence is false", () => {
    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 0,
      proactiveWakeupMaxPerHour: 100
    });
    const blocks = [makeBlock("b1", "some summary", ["kw1"])];
    const plan = planner.buildPlan({
      userInput: "test",
      context: makeContext(blocks, makeSignal({ evidenceNeedHint: "none" }))
    });
    expect(plan.searchQueries).toHaveLength(0);
  });
});
