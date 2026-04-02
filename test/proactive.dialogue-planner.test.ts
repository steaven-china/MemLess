import { describe, expect, test, vi } from "vitest";

import { ProactiveDialoguePlanner } from "../src/proactive/ProactiveDialoguePlanner.js";
import type { Context, ProactiveSignal } from "../src/types.js";

function createContext(signal?: ProactiveSignal): Context {
  return {
    blocks: [],
    recentEvents: [],
    formatted: "",
    proactiveSignal: signal
  };
}

describe("ProactiveDialoguePlanner", () => {
  test("returns noop when proactive signal is unavailable", () => {
    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 10,
      proactiveWakeupMaxPerHour: 3
    });

    const plan = planner.buildPlan({
      userInput: "继续",
      context: createContext()
    });

    expect(plan.action).toBe("noop");
    expect(plan.reason).toBe("signal_unavailable");
    expect(plan.shouldSearchEvidence).toBe(false);
  });

  test("generates follow-up plan for inject mode and enforces required evidence", () => {
    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 10,
      proactiveWakeupMaxPerHour: 3
    });

    const plan = planner.buildPlan({
      userInput: "支付重试",
      context: createContext({
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "支付重试修复", confidence: 0.9 }],
        reason: "inject_ready",
        evidenceNeedHint: "search_required",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      })
    });

    expect(plan.action).toBe("ask_followup");
    expect(plan.shouldSearchEvidence).toBe(true);
    expect(plan.searchQueries).toEqual(["支付重试"]);
    expect(plan.messageSeed).toContain("支付重试修复");
  });

  test("uses low entropy relation-oriented prompt for low entropy reasons", () => {
    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 0,
      proactiveWakeupMaxPerHour: 3
    });

    const plan = planner.buildPlan({
      userInput: "继续",
      context: createContext({
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.8 }],
        reason: "low_entropy_soft",
        evidenceNeedHint: "search_optional",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      })
    });

    expect(plan.action).toBe("ask_followup");
    expect(plan.shouldSearchEvidence).toBe(false);
    expect(plan.messageSeed).toContain("关系信息");
  });

  test("uses topic-shift prompt for topic shift reasons", () => {
    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 0,
      proactiveWakeupMaxPerHour: 3
    });

    const plan = planner.buildPlan({
      userInput: "继续",
      context: createContext({
        allowWakeup: true,
        mode: "inject",
        intents: [{ blockId: "b1", label: "任务A", confidence: 0.8 }],
        reason: "topic_shift_soft",
        evidenceNeedHint: "search_optional",
        triggerSource: "user",
        timerEnabled: true,
        timerIntervalSeconds: 30
      })
    });

    expect(plan.action).toBe("ask_followup");
    expect(plan.shouldSearchEvidence).toBe(false);
    expect(plan.messageSeed).toContain("切换了话题");
  });

  test("blocks by cooldown and hourly budget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T10:00:00.000Z"));

    const planner = new ProactiveDialoguePlanner({
      proactiveWakeupRequireEvidence: false,
      proactiveWakeupMinIntervalSeconds: 60,
      proactiveWakeupMaxPerHour: 1
    });
    const context = createContext({
      allowWakeup: true,
      mode: "inject",
      intents: [{ blockId: "b1", label: "任务A", confidence: 0.8 }],
      reason: "inject_ready",
      evidenceNeedHint: "none",
      triggerSource: "user",
      timerEnabled: true,
      timerIntervalSeconds: 30
    });

    const first = planner.buildPlan({ userInput: "继续", context });
    expect(first.action).toBe("ask_followup");

    const cooldown = planner.buildPlan({ userInput: "继续", context });
    expect(cooldown.action).toBe("noop");
    expect(cooldown.reason).toBe("cooldown_blocked");

    vi.setSystemTime(new Date("2026-03-27T10:02:00.000Z"));
    const budget = planner.buildPlan({ userInput: "继续", context });
    expect(budget.action).toBe("noop");
    expect(budget.reason).toBe("hourly_budget_blocked");

    vi.useRealTimers();
  });
});
